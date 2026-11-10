// state.ts — the Focus Agent state machine (TECHNICAL_DESIGN §7.2).
// IDLE → PAIRED (enroll poll succeeds) → FOCUSING (authed enterFocus) and back to PAIRED on
// every end trigger; revoked/unpair returns to IDLE. Illegal transitions throw instead of
// silently pretending focus is on or off, because the dashboard treats this state as truth
// (INV-5) and a stuck FOCUSING state is a Critical defect (AGENTS §15).

import type { AgentState } from '@focus-mode/shared';

const TRANSITIONS: Readonly<Record<AgentState, readonly AgentState[]>> = Object.freeze({
  IDLE: ['PAIRED'],
  PAIRED: ['IDLE', 'FOCUSING'],
  FOCUSING: ['PAIRED', 'IDLE'],
});

export class InvalidStateTransitionError extends Error {
  readonly from: AgentState;
  readonly to: AgentState;

  constructor(from: AgentState, to: AgentState) {
    super(`Illegal Focus Agent transition ${from} → ${to}`);
    this.name = 'InvalidStateTransitionError';
    this.from = from;
    this.to = to;
  }
}

/** Small, synchronous state holder. No I/O; the controller owns the focus side effects. */
export class AgentStateMachine {
  #state: AgentState;

  constructor(initial: AgentState = 'IDLE') {
    this.#state = initial;
  }

  getState(): AgentState {
    return this.#state;
  }

  canTransitionTo(next: AgentState): boolean {
    return TRANSITIONS[this.#state].includes(next);
  }

  /** Applies a transition or throws `InvalidStateTransitionError`. */
  transitionTo(next: AgentState): AgentState {
    if (!this.canTransitionTo(next)) throw new InvalidStateTransitionError(this.#state, next);
    this.#state = next;
    return this.#state;
  }

  /** Enroll poll succeeded (or a persisted pairing was restored at startup). */
  markPaired(): AgentState {
    // A late pairing callback must never end an active focus session (INV-5).
    if (this.#state !== 'IDLE') return this.#state;
    return this.transitionTo('PAIRED');
  }

  /** `enterFocus` succeeded; only legal once paired. */
  markFocusing(): AgentState {
    return this.transitionTo('FOCUSING');
  }

  /** Every focus end path: timer, dashboard, tray, sleep, crash recovery, quit. */
  markFocusEnded(): AgentState {
    if (this.#state === 'PAIRED') return this.#state;
    if (this.#state === 'FOCUSING') return this.transitionTo('PAIRED');
    return this.#state;
  }

  /** Revoked/unpaired (the controller restores before calling this). */
  reset(): AgentState {
    if (this.#state === 'IDLE') return this.#state;
    return this.transitionTo('IDLE');
  }
}
