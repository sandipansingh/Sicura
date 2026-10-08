import {
  validate,
  type CredentialContextFacts,
  type CredentialEvidence,
} from '../../../contracts/src/index';

/** Context decision only; callers cannot use this to authenticate credentials. */
export function classifyCredential(
  facts: CredentialContextFacts,
): CredentialEvidence['classification'] | null {
  validate('CredentialContextFacts', facts);
  if (!facts.literal) return null;
  if (facts.placeholder) return 'placeholder';
  if (facts.public_identifier) return 'public_identifier';
  return facts.strong_secret_signal ? 'likely_secret' : 'uncertain';
}
