/**
 * Outbound email boundary. ADR-0013 (provider choice) is open, so M1 ships an
 * interface plus a structured-log sender for local/staging use; a real
 * provider slots in behind the same interface without touching domain logic.
 */
export interface OutboundEmail {
  to: string;
  subject: string;
  /** Plain text body. Links are the only action mechanism — no HTML in M1. */
  text: string;
}

export interface EmailSender {
  send(email: OutboundEmail): Promise<void>;
}

/**
 * Development/staging sender: emits a structured log line so operators can
 * retrieve verification/reset/invite links. Never logs beyond the console.
 */
export class ConsoleEmailSender implements EmailSender {
  async send(email: OutboundEmail): Promise<void> {
    console.log(
      JSON.stringify({
        event: 'email.outbound',
        to: email.to,
        subject: email.subject,
        text: email.text,
      }),
    );
  }
}

/** Test sender: captures messages in memory for assertions. */
export class InMemoryEmailSender implements EmailSender {
  readonly sent: OutboundEmail[] = [];

  async send(email: OutboundEmail): Promise<void> {
    this.sent.push(email);
  }

  lastTo(address: string): OutboundEmail | undefined {
    return [...this.sent].reverse().find((message) => message.to === address);
  }
}
