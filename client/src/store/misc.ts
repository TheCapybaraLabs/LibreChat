import { atom } from 'recoil';
import { TAttachment } from 'librechat-data-provider';
import { atomWithLocalStorage } from './utils';
import { BadgeItem } from '~/common';

export type ProtectionPhase =
  | 'idle'
  | 'anonymizing'
  | 'protected'
  | 'streaming'
  | 'blocked'
  | 'degraded'
  | 'failed';

export type SessionProtectionEntry = {
  entityCount: number;
  entityTypes: string[];
  processingMs?: number;
};

const hideBannerHint = atomWithLocalStorage('hideBannerHint', [] as string[]);

const messageAttachmentsMap = atom<Record<string, TAttachment[] | undefined>>({
  key: 'messageAttachmentsMap',
  default: {},
});

const queriesEnabled = atom<boolean>({
  key: 'queriesEnabled',
  default: true,
});

const isEditingBadges = atom<boolean>({
  key: 'isEditingBadges',
  default: false,
});

const chatBadges = atomWithLocalStorage<Pick<BadgeItem, 'id'>[]>('chatBadges', [
  // When adding new badges, make sure to add them to useChatBadges.ts as well and add them as last item
  // DO NOT CHANGE THE ORDER OF THE BADGES ALREADY IN THE ARRAY
  { id: '1' },
  // { id: '2' },
]);

const anonymizeEnabled = atomWithLocalStorage('librechat_anonymize_enabled', false);

const protectionPhase = atom<ProtectionPhase>({
  key: 'protectionPhase',
  default: 'idle',
});

const sessionProtectionMap = atom<Record<string, SessionProtectionEntry>>({
  key: 'sessionProtectionMap',
  default: {},
});

export default {
  hideBannerHint,
  messageAttachmentsMap,
  queriesEnabled,
  isEditingBadges,
  chatBadges,
  anonymizeEnabled,
  protectionPhase,
  sessionProtectionMap,
};
