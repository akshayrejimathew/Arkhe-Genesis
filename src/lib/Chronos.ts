// src/lib/Chronos.ts
/**
 * Chronos.ts
 * Git‑style DAG history with branching and merging.
 * Supports checkpoints, branches, merge commits, and automatic pruning.
 *
 * PINNACLE SPRINT FIX — SHADOW-NEW-04 (2026-02-21):
 *
 *   Cross-branch redo corruption — FIXED.
 *
 *   Root cause:
 *     `redo()` previously selected `childrenTxIds[0]` unconditionally.
 *     When commit C has children on two branches (D_main, D_feature), the
 *     child recorded first wins — regardless of which branch the researcher
 *     is currently working on. A researcher on `main` who undoes to C and
 *     then redoes would silently advance to `D_feature`'s mutations while
 *     the UI still displayed "main". The genome sequence diverged from the
 *     branch the researcher believed they were editing.
 *
 *   Fix (4 lines):
 *     Before falling back to index 0, search `childrenTxIds` for the child
 *     whose `branchName` matches `this.currentBranch`. If found, use it.
 *     If not found (single-branch history, or detached HEAD), fall back to
 *     index 0 — preserving all existing single-branch behavior.
 *
 *   Before:
 *     const nextCommitId = currentCommit.childrenTxIds[0];
 *
 *   After:
 *     const branchMatchedChildId = currentCommit.childrenTxIds.find(id => {
 *       const child = this.commits.get(id);
 *       return child?.branchName === this.currentBranch;
 *     });
 *     const nextCommitId = branchMatchedChildId ?? currentCommit.childrenTxIds[0];
 */

import type { MutationRecord, BaseCode } from '../types/arkhe';

export interface Commit {
  txId: string;
  parentTxIds: string[];
  childrenTxIds: string[];
  mutations: MutationRecord[];
  timestamp: number;
  author?: string;
  commitMessage?: string;
  branchName?: string;
  isCheckpoint?: boolean;
}

export interface Branch {
  name: string;
  headCommitId: string;
  createdAt: number;
}

const MAX_COMMITS = 5000;

export class Chronos {
  private commits: Map<string, Commit> = new Map();
  private branches: Map<string, Branch> = new Map();
  private headCommitId: string | null = null;
  private currentBranch: string = 'main';

  constructor() {
    this.branches.set('main', { name: 'main', headCommitId: '', createdAt: Date.now() });
  }

  // --- Core commit methods ---
  commit(
    mutations: MutationRecord[],
    author?: string,
    commitMessage?: string,
    branchName: string = this.currentBranch,
    isCheckpoint: boolean = false
  ): string {
    const txId = this.generateTxId(mutations);
    const parentIds = this.getParentIdsForBranch(branchName);
    const commit: Commit = {
      txId,
      parentTxIds: parentIds,
      childrenTxIds: [],
      mutations,
      timestamp: Date.now(),
      author,
      commitMessage,
      branchName,
      isCheckpoint,
    };
    this.commits.set(txId, commit);

    for (const parentId of parentIds) {
      const parent = this.commits.get(parentId);
      if (parent) {
        parent.childrenTxIds.push(txId);
      }
    }

    this.branches.set(branchName, {
      name: branchName,
      headCommitId: txId,
      createdAt: this.branches.get(branchName)?.createdAt || Date.now(),
    });

    this.headCommitId = txId;
    this.currentBranch = branchName;

    if (this.commits.size > MAX_COMMITS) {
      this.pruneUnreachableCommits();
    }

    return txId;
  }

  private getParentIdsForBranch(branchName: string): string[] {
    const branch = this.branches.get(branchName);
    if (branch && branch.headCommitId) {
      return [branch.headCommitId];
    }
    if (this.headCommitId) {
      return [this.headCommitId];
    }
    return [];
  }

  // --- Branch operations ---
  createBranch(branchName: string, fromCommitId?: string): boolean {
    if (this.branches.has(branchName)) return false;
    const sourceCommitId = fromCommitId || this.headCommitId;
    if (!sourceCommitId) return false;
    this.branches.set(branchName, {
      name: branchName,
      headCommitId: sourceCommitId,
      createdAt: Date.now(),
    });
    return true;
  }

  checkout(branchName: string): boolean {
    const branch = this.branches.get(branchName);
    if (!branch) return false;
    this.currentBranch = branchName;
    this.headCommitId = branch.headCommitId;
    return true;
  }

  merge(
    sourceBranch: string,
    targetBranch: string = this.currentBranch,
    mergeMessage?: string
  ): string | null {
    const source = this.branches.get(sourceBranch);
    const target = this.branches.get(targetBranch);
    if (!source || !target) return null;

    const mergeCommit: Commit = {
      txId: this.generateTxId([]),
      parentTxIds: [target.headCommitId, source.headCommitId],
      childrenTxIds: [],
      mutations: [],
      timestamp: Date.now(),
      author: 'merge',
      commitMessage: mergeMessage || `Merge branch '${sourceBranch}' into ${targetBranch}`,
      branchName: targetBranch,
    };
    this.commits.set(mergeCommit.txId, mergeCommit);

    for (const parentId of mergeCommit.parentTxIds) {
      const parent = this.commits.get(parentId);
      if (parent) parent.childrenTxIds.push(mergeCommit.txId);
    }

    this.branches.set(targetBranch, {
      ...target,
      headCommitId: mergeCommit.txId,
    });
    this.headCommitId = mergeCommit.txId;
    this.currentBranch = targetBranch;

    if (this.commits.size > MAX_COMMITS) {
      this.pruneUnreachableCommits();
    }

    return mergeCommit.txId;
  }

  // --- Undo/Redo (branch‑aware) ---
  undo(): MutationRecord[] | null {
    const currentCommit = this.headCommitId ? this.commits.get(this.headCommitId) : null;
    if (!currentCommit) return null;
    if (currentCommit.parentTxIds.length === 0) return null;

    this.headCommitId = currentCommit.parentTxIds[0];
    this.branches.set(this.currentBranch, {
      ...this.branches.get(this.currentBranch)!,
      headCommitId: this.headCommitId,
    });

    const reverseOps = [...currentCommit.mutations].reverse().map(m => ({
      ...m,
      oldBase: m.newBase,
      newBase: m.oldBase,
      txId: `undo-${m.txId}`,
    }));
    return reverseOps;
  }

  /**
   * redo — SHADOW-NEW-04 FIX: branch-aware child selection.
   *
   * When a commit has children on multiple branches (e.g. both `main` and
   * `feature-branch` diverge from the same parent), we must advance to the
   * child that belongs to the currently checked-out branch. Falling straight
   * to `childrenTxIds[0]` would silently cross branch lines.
   *
   * Priority:
   *   1. First child whose `branchName === this.currentBranch`  ← branch-safe
   *   2. `childrenTxIds[0]` (fallback — preserves single-branch behavior)
   */
  redo(): MutationRecord[] | null {
    const currentCommit = this.headCommitId ? this.commits.get(this.headCommitId) : null;
    if (!currentCommit) return null;
    if (currentCommit.childrenTxIds.length === 0) return null;

    // ── SHADOW-NEW-04 FIX: prefer the child that matches the active branch ──
    const branchMatchedChildId = currentCommit.childrenTxIds.find(id => {
      const child = this.commits.get(id);
      return child?.branchName === this.currentBranch;
    });
    const nextCommitId = branchMatchedChildId ?? currentCommit.childrenTxIds[0];
    // ── end fix ─────────────────────────────────────────────────────────────

    const nextCommit = this.commits.get(nextCommitId);
    if (!nextCommit) return null;

    this.headCommitId = nextCommitId;
    this.branches.set(this.currentBranch, {
      ...this.branches.get(this.currentBranch)!,
      headCommitId: this.headCommitId,
    });

    return nextCommit.mutations.map(m => ({ ...m }));
  }

  // --- Getters ---
  getCurrentBranch(): string {
    return this.currentBranch;
  }

  getHeadCommitId(): string | null {
    return this.headCommitId;
  }

  getCommit(txId: string): Commit | undefined {
    return this.commits.get(txId);
  }

  getAllCommits(): Commit[] {
    return Array.from(this.commits.values());
  }

  getBranches(): Branch[] {
    return Array.from(this.branches.values());
  }

  // --- Export / Persistence ---
  exportPatch(
    txId: string
  ): { txId: string; diffs: { offset: number; from: BaseCode; to: BaseCode }[] } | null {
    const commit = this.commits.get(txId);
    if (!commit) return null;
    const diffs = commit.mutations.map(m => ({
      offset: m.offset,
      from: m.oldBase,
      to: m.newBase,
    }));
    return { txId, diffs };
  }

  private generateTxId(mutations: MutationRecord[]): string {
    const content = mutations
      .map(m => `${m.offset}:${m.oldBase}->${m.newBase}`)
      .join('|');
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      hash = (hash << 5) - hash + content.charCodeAt(i);
      hash |= 0;
    }
    return `tx-${Date.now()}-${Math.abs(hash).toString(16)}`;
  }

  // --- Pruning: keep only commits reachable from any branch head ---
  private pruneUnreachableCommits(): void {
    const reachable = new Set<string>();
    const queue: string[] = [];

    for (const branch of this.branches.values()) {
      if (branch.headCommitId && this.commits.has(branch.headCommitId)) {
        queue.push(branch.headCommitId);
      }
    }

    while (queue.length) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      const commit = this.commits.get(id);
      if (commit) {
        for (const parent of commit.parentTxIds) {
          queue.push(parent);
        }
      }
    }

    for (const id of this.commits.keys()) {
      if (!reachable.has(id)) {
        this.commits.delete(id);
      }
    }

    for (const [branchName, branch] of this.branches.entries()) {
      if (!this.commits.has(branch.headCommitId)) {
        const mainBranch = this.branches.get('main');
        if (mainBranch && this.commits.has(mainBranch.headCommitId)) {
          branch.headCommitId = mainBranch.headCommitId;
        } else if (this.commits.size > 0) {
          const allCommits = Array.from(this.commits.values());
          const latest = allCommits.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
          branch.headCommitId = latest.txId;
        } else {
          branch.headCommitId = '';
        }
        this.branches.set(branchName, branch);
      }
    }

    if (this.headCommitId && !this.commits.has(this.headCommitId)) {
      const mainBranch = this.branches.get('main');
      this.headCommitId = mainBranch?.headCommitId || null;
    }
  }

  // --- Restore from serialized data ---
  restore(commits: Commit[], branches: Branch[], headCommitId: string): void {
    this.commits.clear();
    commits.forEach(c => this.commits.set(c.txId, c));
    this.branches.clear();
    branches.forEach(b => this.branches.set(b.name, b));
    this.headCommitId = headCommitId;
    this.currentBranch =
      branches.find(b => b.headCommitId === headCommitId)?.name || 'main';
  }
}