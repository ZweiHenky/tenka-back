import type { WaitlistEntryCreateData } from './entity';

export interface WaitlistRepository {
  create(data: WaitlistEntryCreateData): Promise<void>;
}
