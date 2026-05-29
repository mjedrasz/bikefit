export type SessionStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface FittingSession {
  id: string;
  user_id: string;
  status: SessionStatus;
  video_r2_key: string | null;
  video_filename: string | null;
  video_duration_s: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface Recommendation {
  adjustment: string;
  rationale: string;
}

export interface BodyAngle {
  name: string;
  value: number;
  reference_min: number;
  reference_max: number;
  unit: string;
}

export interface AnalysisResult {
  id: string;
  session_id: string;
  recommendations: Recommendation[];
  body_angles: BodyAngle[];
  raw_llm_response: string | null;
  created_at: string;
}
