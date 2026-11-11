import test from 'node:test';
import assert from 'node:assert/strict';
import {explainOpenAIError} from '../src/openai-client.js';
test('missing and invalid API keys classified',()=>assert.match(explainOpenAIError(401),/API key/));
test('billing errors classified',()=>assert.match(explainOpenAIError(429,'credit_balance_exhausted'),/credits/));
test('rate limit classified',()=>assert.match(explainOpenAIError(429,'rate_limit_exceeded'),/limit/));
test('model not found classified',()=>assert.match(explainOpenAIError(404,'model_not_found'),/model/));
