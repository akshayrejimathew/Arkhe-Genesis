export interface SystemLog {
  level: 'info' | 'success' | 'warning' | 'error' | 'debug';
  category: 'SYSTEM' | 'WORKER' | 'MEMORY' | 'CHRONOS' | 'SENTINEL' | 'ORF' | 'PCR' | 'REPORT';
  message: string;
  timestamp: number;
}