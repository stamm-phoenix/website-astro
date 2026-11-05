import assert from 'node:assert/strict';
import test from 'node:test';
import type { AzureOpenAiDeployment } from '../lib/azure-openai';
import { CONFIG } from '../lib/config';

// The website has a single deployment for AI (Data Zone Standard, EU only). It is a reasoning
// model, so every feature sets `reasoningEffort`; without it `temperature: 0` is sent and refused.
const FEATURES: Record<string, AzureOpenAiDeployment> = {
  'belege.check': CONFIG.belege.check,
  'essensplanung.ki': CONFIG.essensplanung.ki,
  'problemmeldung.ai': CONFIG.problemmeldung.ai,
  'protokolle.termin': CONFIG.protokolle.termin,
  'protokolle.aufgaben': CONFIG.protokolle.aufgaben,
};

test('every AI feature uses the EU deployment of a reasoning model', () => {
  for (const [name, deployment] of Object.entries(FEATURES)) {
    assert.equal(deployment.endpoint, 'https://website-astro-openai.openai.azure.com', name);
    assert.equal(deployment.deployment, 'gpt-6.1-sol-datazone', name);
    assert.ok(deployment.reasoningEffort, `${name} needs a reasoningEffort`);
  }
});
