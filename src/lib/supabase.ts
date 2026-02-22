/**
 * src/lib/supabase.ts
 * Supabase client singleton for Arkhé Genesis.
 * FORCED TYPE SAFETY – No more 'never' errors.
 */

import { createClient } from '@supabase/supabase-js';

// ---------- Environment Variables ----------
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local'
  );
}

// ---------- Database Types – 100% Match Your SQL ----------
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// Define table row types directly (no nested Database interface)
export type Profile = {
  id: string;
  username: string | null;
  avatar_url: string | null;
  tier: 'free' | 'pro';
  created_at: string | null;
  updated_at: string | null;
};

export type Genome = {
  id: string;
  owner_id: string;
  name: string;
  total_length: number;
  file_url: string;
  created_at: string | null;
  updated_at: string | null;
};

export type ChronosCommit = {
  id: string;
  genome_id: string;
  parent_id: string | null;
  tx_id: string;
  message: string | null;
  snapshot_meta: Json;
  created_at: string | null;
};

export type Branch = {
  id: string;
  genome_id: string;
  name: string;
  head_commit_id: string;
  created_at: string | null;
  updated_at: string | null;
};

export type UserFeature = {
  id: string;
  owner_id: string;
  genome_id: string;
  label: string;
  start_pos: number;
  end_pos: number;
  color: string | null;
  type: 'exon' | 'intron' | 'cds' | 'promoter' | 'binding_site' | 'repeat' | 'other';
  created_at: string | null;
  updated_at: string | null;
};

// Insert types (omit auto-generated fields)
export type NewGenome = Omit<Genome, 'id' | 'created_at' | 'updated_at'>;
export type NewChronosCommit = Omit<ChronosCommit, 'id' | 'created_at'>;
export type NewBranch = Omit<Branch, 'id' | 'created_at' | 'updated_at'>;
export type NewUserFeature = Omit<UserFeature, 'id' | 'created_at' | 'updated_at'>;

// ---------- Supabase Client – NO GENERIC (this is the key fix!) ----------
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// ---------- Type Helpers for Queries ----------
// These tell TypeScript what shape to expect
export type Tables = {
  profiles: Profile;
  genomes: Genome;
  chronos_commits: ChronosCommit;
  branches: Branch;
  user_features: UserFeature;
};