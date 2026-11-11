import test from 'node:test';
import assert from 'node:assert/strict';
import {words,shingles,textOverlap} from '../src/text-match.js';

test('tokenizer handles punctuation and Unicode',()=>{assert.deepEqual(words('Hello, Philippine–research!'),['hello','philippine','research'])});
test('same paragraph produces complete overlap',()=>{const s='the study describes a practical workflow with secure storage and database validation';assert.equal(textOverlap(s,s),100)});
test('unrelated paragraph does not produce matches',()=>{assert.equal(textOverlap('one two three four five six seven eight','red blue green yellow orange violet black white'),0)});
test('shared phrase is detected but not mislabelled as plagiarism',()=>{const a='some opening words here followed by a very specific repeated seven word phrase and an ending';const b='nothing before followed by a very specific repeated seven word phrase and something after';assert.ok(textOverlap(a,b)>0);assert.ok(textOverlap(a,b)<100)});
test('short texts do not generate a score',()=>{assert.equal(textOverlap('short text','short text'),0);assert.equal(shingles('one two').size,0)});
