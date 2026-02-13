import { Document, Types } from 'mongoose';

export interface IMongoFile extends Omit<Document, 'model'> {
  user: Types.ObjectId;
  conversationId?: string;
  file_id: string;
  temp_file_id?: string;
  bytes: number;
  text?: string;
  filename: string;
  filepath: string;
  object: 'file';
  embedded?: boolean;
  type: string;
  context?: string;
  usage: number;
  source: string;
  model?: string;
  width?: number;
  height?: number;
  metadata?: {
    fileIdentifier?: string;
    anonymized?: boolean;
    anonymization_level?: string;
    stats?: Record<string, unknown>;
    processing_ms_total?: number;
    chunks_count?: number;
    entities_by_chunk?: Array<{ chunk_index: number; entities: unknown[] }>;
  };
  expiresAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}
