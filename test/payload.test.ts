/**
 * Reading GitHub's JSON without trusting it.
 *
 * The bodies here are hand-written from the field lists GitHub publishes for
 * the `workflow_run` webhook, for the workflow run object and for a jobs
 * listing, read on 2026-08-25 and cited in `src/attribution.ts`. Nothing here
 * has ever spoken to GitHub and no credential appears in this repository.
 */

import { describe, expect, it } from 'vitest';
import { jobFactsFrom, jobFactsListFrom, workflowRunFactsFrom } from '../src/payload.js';
import { classifyWorkflowRun } from '../src/attribution.js';

const DELIVERY = {
  action: 'completed',
  repository: { full_name: 'acme/widgets', default_branch: 'main' },
  workflow_run: {
    id: 10_500_400_300,
    name: 'CI',
    path: '.github/workflows/ci.yml',
    head_branch: 'main',
    event: 'push',
    status: 'completed',
    conclusion: 'failure',
  },
};

describe('workflowRunFactsFrom', () => {
  it('lifts the eight documented fields the classifier reads', () => {
    expect(workflowRunFactsFrom(DELIVERY)).toEqual({
      action: 'completed',
      status: 'completed',
      conclusion: 'failure',
      triggeringEvent: 'push',
      headBranch: 'main',
      defaultBranch: 'main',
      repositoryFullName: 'acme/widgets',
      workflowPath: '.github/workflows/ci.yml',
    });
  });

  it.each([
    ['null', null],
    ['an array', [1, 2, 3]],
    ['a string', 'workflow_run'],
    ['a number', 7],
    ['an empty object', {}],
    ['a run that is not an object', { action: 'completed', workflow_run: 'nope' }],
    ['fields of the wrong type', { action: 5, workflow_run: { conclusion: false } }],
  ])('never throws on %s, and answers with absent facts', (_label, payload) => {
    expect(() => workflowRunFactsFrom(payload)).not.toThrow();
    const facts = workflowRunFactsFrom(payload);
    // And the classifier refuses what it cannot read, rather than proceeding.
    expect(classifyWorkflowRun(facts).attributable).toBe(false);
  });

  it('treats an empty string as an absent field rather than a value', () => {
    const facts = workflowRunFactsFrom({
      ...DELIVERY,
      repository: { full_name: '', default_branch: 'main' },
    });
    expect(facts.repositoryFullName).toBeNull();
  });
});

describe('jobFactsFrom and jobFactsListFrom', () => {
  const listing = {
    total_count: 2,
    jobs: [
      { name: 'lint', conclusion: 'success', steps: [] },
      {
        name: 'unit',
        conclusion: 'failure',
        steps: [
          { name: 'Set up job', number: 1, status: 'completed', conclusion: 'success' },
          { name: 'pnpm test', number: 2, status: 'completed', conclusion: 'failure' },
        ],
      },
    ],
  };

  it('reads the documented envelope', () => {
    const jobs = jobFactsListFrom(listing);
    expect(jobs).toHaveLength(2);
    expect(jobs[1]?.conclusion).toBe('failure');
    expect(jobs[1]?.steps[1]).toEqual({
      name: 'pnpm test',
      number: 2,
      status: 'completed',
      conclusion: 'failure',
    });
  });

  it('reads a bare array too, which is what a paginating caller holds', () => {
    /* Asserted against written-down facts rather than against
     * `jobFactsListFrom(listing)`. Comparing the function's two answers to
     * each other passes for any implementation that is merely CONSISTENT,
     * including one that returns [] for both, which is the shape this test
     * was written in and the reason it proved nothing about either form. */
    const jobs = jobFactsListFrom(listing.jobs);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]?.name).toBe('lint');
    expect(jobs[0]?.conclusion).toBe('success');
    expect(jobs[1]?.name).toBe('unit');
    expect(jobs[1]?.conclusion).toBe('failure');
    expect(jobs[1]?.steps[1]).toEqual({
      name: 'pnpm test',
      number: 2,
      status: 'completed',
      conclusion: 'failure',
    });
    /* And the two forms agree, which is the claim in the title. */
    expect(jobs).toEqual(jobFactsListFrom(listing));
  });

  it('drops steps that are not objects rather than failing the whole listing', () => {
    const facts = jobFactsFrom({ name: 'unit', conclusion: 'failure', steps: [null, 'x', 3, {}] });
    expect(facts.steps).toHaveLength(1);
    expect(facts.steps[0]).toEqual({ name: null, number: null, status: null, conclusion: null });
  });

  it.each([
    ['null', null],
    ['a string', 'jobs'],
    ['an envelope with no jobs', { total_count: 0 }],
    ['an envelope whose jobs are not an array', { jobs: 'nope' }],
  ])('answers an empty list for %s rather than throwing', (_label, payload) => {
    expect(jobFactsListFrom(payload)).toEqual([]);
  });
});
