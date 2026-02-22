/**
 * supabasePublic.ts
 * Bridge to fetch public genome sequences from Supabase.
 * Assumes a table `public_sequences` with columns:
 * - id (uuid)
 * - name (text)
 * - description (text)
 * - file_url (text)
 * - total_length (bigint)
 * - created_at (timestamp)
 * - author (text)
 * - tags (text[])
 */

import { supabase } from './supabase';

export interface PublicGenome {
  id: string;
  name: string;
  description: string;
  file_url: string;
  total_length: number;
  created_at: string;
  author: string;
  tags: string[];
}

export async function fetchPublicGenomes(): Promise<PublicGenome[]> {
  const { data, error } = await supabase
    .from('public_sequences')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function fetchPublicGenomeById(id: string): Promise<PublicGenome> {
  const { data, error } = await supabase
    .from('public_sequences')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}