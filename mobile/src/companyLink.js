import { createURL } from 'expo-linking';
import { Platform } from 'react-native';

const codePattern = /^[a-f0-9]{12}$/i;
const invitationPattern = /^(?:qwork(?:-local)?:\/\/\/?|exps?:\/\/[^/?#\s]+\/--\/)invite\/([a-f0-9]{12})\/?(?:[?#][^\s]*)?$/i;
const employeeTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const employeeInvitationPattern = /^(?:qwork(?:-local)?:\/\/\/?|exps?:\/\/[^/?#\s]+\/--\/)join\/([A-Za-z0-9_-]{43})\/?$/;
const publicOriginPattern = /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?\/?$/i;
const publicInvitationPattern = /^([^/]+\/\/[^/]+)\/join#([A-Za-z0-9_-]{43})$/;
const configuredOrigin = (process.env.EXPO_PUBLIC_QWORK_INVITE_URL ?? '').trim();
const publicOrigin = publicOriginPattern.test(configuredOrigin)
  ? configuredOrigin.replace(/\/$/, '').toLowerCase()
  : '';
const browserOrigin = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : '';

export function parseCompanyLink(value) {
  const match = typeof value === 'string' ? value.trim().match(invitationPattern) : null;
  if (match) return match[1].toUpperCase();
  if (browserOrigin && typeof value === 'string') {
    try {
      const url = new URL(value.trim());
      const code = url.pathname.match(/^\/invite\/([a-f0-9]{12})\/?$/i);
      if (url.origin === browserOrigin && code) return code[1].toUpperCase();
    } catch {}
  }
  return null;
}

export function createCompanyLink(code) {
  if (typeof code !== 'string' || !codePattern.test(code)) return '';
  if (browserOrigin) return `${browserOrigin}/invite/${code}`;
  const url = createURL(`invite/${code}`);
  return parseCompanyLink(url) ? url : '';
}

export function parseEmployeeInvite(value) {
  if (typeof value !== 'string') return null;
  const link = value.trim();
  const nativeMatch = link.match(employeeInvitationPattern);
  if (nativeMatch) return nativeMatch[1];
  const publicMatch = link.match(publicInvitationPattern);
  if (!publicMatch || ![publicOrigin, browserOrigin].filter(Boolean).includes(publicMatch[1].toLowerCase())) return null;
  return publicMatch[2];
}

export function createEmployeeInvite(token) {
  if (typeof token !== 'string' || !employeeTokenPattern.test(token)) return '';
  if (browserOrigin) return `${browserOrigin}/join#${token}`;
  if (configuredOrigin) return publicOrigin ? `${publicOrigin}/join#${token}` : '';
  const url = createURL(`join/${token}`);
  return parseEmployeeInvite(url) ? url : '';
}
