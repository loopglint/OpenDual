import type { ExtensionSettings, SiteRule } from '../config/types';
import { BUILTIN_SITE_RULES } from './builtin-rules';

// Matches a hostname or full URL against a wildcard rule pattern:
// - "github.com" matches hostname github.com
// - "*.reddit.com" matches reddit.com and subdomains like www.reddit.com / old.reddit.com
// - "github.com/*/blob/*" matches hostname + pathname wildcard
export function matchUrlPattern(rawUrl: string, pattern: string): boolean {
  const cleanPattern = pattern.trim().toLowerCase();
  if (!cleanPattern) return false;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  const hostAndPath = `${host}${parsed.pathname}`.toLowerCase();

  // Pattern contains a path slash -> match against host+path
  if (cleanPattern.includes('/')) {
    const stripped = cleanPattern.replace(/^https?:\/\//, '');
    const regexStr =
      '^' +
      stripped
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*') +
      '$';
    return new RegExp(regexStr, 'i').test(hostAndPath);
  }

  // Hostname-only pattern
  if (cleanPattern.startsWith('*.')) {
    const base = cleanPattern.slice(2);
    return host === base || host.endsWith(`.${base}`);
  }

  if (cleanPattern.includes('*')) {
    const regexStr =
      '^' +
      cleanPattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*') +
      '$';
    return new RegExp(regexStr, 'i').test(host);
  }

  return host === cleanPattern || host === `www.${cleanPattern}`;
}

export function ruleMatchesUrl(rule: SiteRule, url: string): boolean {
  if (rule.enabled === false) return false;
  const matched = rule.matches.some((p) => matchUrlPattern(url, p));
  if (!matched) return false;
  if (rule.excludeMatches && rule.excludeMatches.some((p) => matchUrlPattern(url, p))) {
    return false;
  }
  return true;
}

/**
 * Resolves the active SiteRule with strict precedence:
 * User Custom Rules > Enabled Builtin Site Rules > null (Heuristic Fallback)
 */
export function resolveSiteRule(url: string, settings: ExtensionSettings): SiteRule | null {
  for (const userRule of settings.userRules) {
    if (ruleMatchesUrl(userRule, url)) {
      return userRule;
    }
  }

  const disabledSet = new Set(settings.disabledBuiltinRuleIds);
  for (const builtinRule of BUILTIN_SITE_RULES) {
    if (disabledSet.has(builtinRule.id)) continue;
    if (ruleMatchesUrl(builtinRule, url)) {
      return builtinRule;
    }
  }

  return null;
}

export function isDomainInList(url: string, domains: string[]): boolean {
  return domains.some((d) => matchUrlPattern(url, d));
}
