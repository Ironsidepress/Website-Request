import { ConsoleEmailSender, type EmailSender, type OutboundEmail } from '@website-factory/core';

/**
 * Development-only email capture. In `APP_ENV=development` the app stores
 * outbound email in memory (and still logs it) so local testing and the E2E
 * suite can retrieve verification/invitation links via /api/dev/emails.
 * The endpoint hard-404s outside development; nothing here ships behavior to
 * staging or production.
 */
const inbox: OutboundEmail[] = [];
const console_ = new ConsoleEmailSender();

export class DevInboxEmailSender implements EmailSender {
  async send(email: OutboundEmail): Promise<void> {
    inbox.push(email);
    if (inbox.length > 200) inbox.shift();
    await console_.send(email);
  }
}

export function lastDevEmailTo(address: string): OutboundEmail | undefined {
  return [...inbox].reverse().find((email) => email.to.toLowerCase() === address.toLowerCase());
}
