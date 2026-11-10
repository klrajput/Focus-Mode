// state.test.ts — the IDLE → PAIRED → FOCUSING machine (T-030).
// Illegal transitions must throw rather than silently report the wrong focus state, because the
// dashboard trusts this machine as the source of truth (INV-5).

import { describe, expect, it } from 'vitest';
import { AgentStateMachine, InvalidStateTransitionError } from './state.js';

describe('AgentStateMachine', () => {
  it('starts IDLE and follows the documented happy path', () => {
    const machine = new AgentStateMachine();
    expect(machine.getState()).toBe('IDLE');

    expect(machine.markPaired()).toBe('PAIRED');
    expect(machine.markFocusing()).toBe('FOCUSING');
    expect(machine.markFocusEnded()).toBe('PAIRED');
    expect(machine.reset()).toBe('IDLE');
  });

  it('refuses FOCUSING before pairing', () => {
    const machine = new AgentStateMachine();
    expect(() => machine.markFocusing()).toThrow(InvalidStateTransitionError);
    expect(machine.getState()).toBe('IDLE');
  });

  it('refuses to re-enter focus while FOCUSING (FR-024 guard)', () => {
    const machine = new AgentStateMachine('PAIRED');
    machine.markFocusing();
    expect(() => machine.transitionTo('FOCUSING')).toThrow(InvalidStateTransitionError);
  });

  it('treats markPaired and markFocusEnded as idempotent in their target state', () => {
    const machine = new AgentStateMachine('PAIRED');
    expect(machine.markPaired()).toBe('PAIRED');
    expect(machine.markFocusEnded()).toBe('PAIRED');
    expect(machine.getState()).toBe('PAIRED');
  });

  it('keeps a focusing state when a late pairing callback arrives', () => {
    const machine = new AgentStateMachine('PAIRED');
    machine.markFocusing();
    expect(machine.markPaired()).toBe('FOCUSING');
  });

  it('reports the rejected transition for diagnostics', () => {
    const machine = new AgentStateMachine('IDLE');
    try {
      machine.transitionTo('FOCUSING');
      expect.unreachable('transition should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidStateTransitionError);
      const transition = error as InvalidStateTransitionError;
      expect(transition.from).toBe('IDLE');
      expect(transition.to).toBe('FOCUSING');
    }
  });

  it('rejects a focus end from IDLE without changing state', () => {
    const machine = new AgentStateMachine('IDLE');
    expect(machine.markFocusEnded()).toBe('IDLE');
  });
});
