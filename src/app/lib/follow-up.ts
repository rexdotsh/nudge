import { FOLLOW_UP_EVERY_MINUTES, FOLLOW_UP_MINUTES, type FollowUpSetting } from '../../shared/fire';
import { alertLabel } from './format';

const CHOICES: readonly { setting: FollowUpSetting; label: string; group?: string }[] = [
  { setting: 'off', label: 'Off' },
  ...FOLLOW_UP_MINUTES.map((minutes) => ({ setting: minutes, label: alertLabel(minutes), group: 'Once, after' })),
  ...FOLLOW_UP_EVERY_MINUTES.map((minutes) => ({
    setting: { every: minutes },
    label: minutes === 60 ? 'Every hour' : `Every ${minutes} min`,
    group: 'Until done',
  })),
];

/** What the setting does, in a few words. */
export function followUpNote(setting: FollowUpSetting): string {
  if (setting === 'off') return "If a reminder isn't done";
  return typeof setting === 'number' ? "Once, if a reminder isn't done" : "Until it's done, up to a day";
}

/** A picker's options carry text, so each setting goes by its JSON. */
export const followUpKey = (setting: FollowUpSetting): string => JSON.stringify(setting);

export const FOLLOW_UP_OPTIONS = CHOICES.map(({ setting, label, group }) => ({
  value: followUpKey(setting),
  label,
  group,
}));

export function pickedFollowUp(key: string): FollowUpSetting | undefined {
  return CHOICES.find(({ setting }) => followUpKey(setting) === key)?.setting;
}
