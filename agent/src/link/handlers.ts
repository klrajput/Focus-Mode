// link/handlers.ts — authenticated local-channel control messages → FocusController (T-051).
// `enterFocus`, `exitFocus` and `listApps` are only reachable on an attested socket (REC-003);
// this module is the single place that maps them onto the controller, so the link server holds
// no focus logic and the controller holds no protocol logic.
// Lifecycle frames (`focusStarted`/`focusEnded`) are *broadcast* by the link server from the
// controller's events (main.ts), which is why a successful control message returns no reply:
// one event = exactly one frame per authenticated dashboard, whether the end came from this
// dashboard, the tray, the timer, sleep or quit (FR-004/INV-5).
// REC-004 stays in the controller: the native consent dialog runs inside `enterFocus` and can
// never be answered by the page.

import type {
  EndReason,
  EnterFocusMessage,
  ExitFocusMessage,
  LocalMessage,
  RunningApp,
} from '@focus-mode/shared';
import { noopLogger, type Logger } from '../log.js';
import {
  FocusRejectedError,
  type EnterFocusRequest,
  type FocusEndedEvent,
  type FocusSnapshot,
} from '../focus/controller.js';
import { buildApps, buildFocusRejected, buildState } from './messages.js';

/** The slice of `FocusController` the local channel may use (INV-1: the agent applies focus). */
export interface FocusControlTarget {
  enterFocus(request: EnterFocusRequest): Promise<FocusSnapshot>;
  exitFocus(reason: EndReason): Promise<FocusEndedEvent | null>;
  getState(): FocusSnapshot;
  /** REC-007; key + label + running only, never titles/URLs (INV-6). */
  listRunningApps(): Promise<readonly RunningApp[]>;
}

/** Injected into `LinkServer`; every method returns the frames to send to the requester. */
export interface LinkControlHandlers {
  enterFocus(message: EnterFocusMessage): Promise<readonly LocalMessage[]>;
  exitFocus(message: ExitFocusMessage): Promise<readonly LocalMessage[]>;
  listApps(): Promise<readonly LocalMessage[]>;
  getState(): LocalMessage;
}

export interface FocusLinkHandlersOptions {
  readonly controller: FocusControlTarget;
  readonly logger?: Logger;
}

const ENTER_FAILED_MESSAGE =
  'Focus could not be applied. Nothing was left minimised — check the Focus Agent and try ' +
  'again.';
const INVALID_MESSAGE = 'That focus request could not be processed.';

export class FocusLinkHandlers implements LinkControlHandlers {
  readonly #controller: FocusControlTarget;
  readonly #logger: Logger;

  constructor(options: FocusLinkHandlersOptions) {
    this.#controller = options.controller;
    this.#logger = options.logger ?? noopLogger;
  }

  /**
   * Starts a dashboard-requested session. The dashboard's `consent` field is forwarded for
   * traceability, but REC-004's native gate is enforced inside the controller; a page can never
   * satisfy it. Errors are mapped to the frozen `focusRejected` code set — never a stack trace.
   */
  async enterFocus(message: EnterFocusMessage): Promise<readonly LocalMessage[]> {
    try {
      await this.#controller.enterFocus({
        durationMin: message.durationMin,
        allowList: message.allowList,
        clientSessionId: message.clientSessionId,
        source: 'MANUAL',
        consent: message.consent,
        ...(message.reaside === undefined ? {} : { reaside: message.reaside }),
      });
      // focusStarted is broadcast from the controller event (see module header).
      return [];
    } catch (error) {
      return [this.#rejection(error, 'enterFocus')];
    }
  }

  /**
   * Ends the session. `sessionId` is optional; when the dashboard sends a stale id we answer
   * with the current state instead of ending a different session. A failed restore keeps the
   * session journaled and answers with the still-FOCUSING state, so the End button stays honest.
   */
  async exitFocus(message: ExitFocusMessage): Promise<readonly LocalMessage[]> {
    const snapshot = this.#controller.getState();
    if (
      message.sessionId !== undefined &&
      snapshot.session?.sessionId !== undefined &&
      snapshot.session.sessionId !== message.sessionId
    ) {
      this.#logger.warn('Ignored an exitFocus for a different session', {
        requested: message.sessionId,
        active: snapshot.session.sessionId,
      });
      return [buildState(snapshot)];
    }

    try {
      const ended = await this.#controller.exitFocus('USER');
      // focusEnded is broadcast from the controller event; a null result means nothing ran.
      return ended === null ? [buildState(this.#controller.getState())] : [];
    } catch (error) {
      this.#logger.error(
        'Dashboard-driven restore failed; the journal is kept and the tray can retry',
        error instanceof Error ? error.message : 'unknown error',
      );
      return [buildState(this.#controller.getState())];
    }
  }

  /** REC-007 allow-list picker: key/label/running only (INV-6). */
  async listApps(): Promise<readonly LocalMessage[]> {
    try {
      return [buildApps(await this.#controller.listRunningApps())];
    } catch (error) {
      this.#logger.error(
        'Could not list running apps for the dashboard',
        error instanceof Error ? error.message : 'unknown error',
      );
      return [buildFocusRejected('INVALID', INVALID_MESSAGE)];
    }
  }

  /** Agent truth for resync (INV-5); served before and after attestation. */
  getState(): LocalMessage {
    return buildState(this.#controller.getState());
  }

  #rejection(error: unknown, operation: 'enterFocus' | 'exitFocus'): LocalMessage {
    if (error instanceof FocusRejectedError) {
      return buildFocusRejected(error.code, error.message);
    }
    this.#logger.error(
      `Focus ${operation} failed unexpectedly; no focus is left applied`,
      error instanceof Error ? error.message : 'unknown error',
    );
    // A driver failure during enterFocus has already restored+cleared the journal (INV-5), so
    // the honest answer is a rejection, never a fake focusStarted.
    return buildFocusRejected('INVALID', ENTER_FAILED_MESSAGE);
  }
}
