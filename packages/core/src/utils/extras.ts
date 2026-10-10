import { Extras, ExtrasSchema } from '../db/schemas.js';

// Callers pass encoded extras; decode values only after separating parameters.
function safeDecodeExtraValue(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

export class ExtrasParser {
  private extras: Partial<Extras>;

  constructor(extras?: string) {
    this.extras = this.parseExtras(extras);
  }

  private parseExtras(extras?: string): Partial<Extras> {
    if (!extras) {
      return {};
    }
    const extrasObject = Object.fromEntries(
      extras.split('&').map((e) => {
        const separator = e.indexOf('=');
        if (separator === -1) return [e, undefined];
        return [
          e.slice(0, separator),
          safeDecodeExtraValue(e.slice(separator + 1)),
        ];
      })
    );

    const parsedExtras = ExtrasSchema.safeParse(extrasObject);
    if (!parsedExtras.success) {
      return {};
    }

    return parsedExtras.data;
  }

  get genre(): string | undefined {
    return 'genre' in this.extras ? this.extras.genre : undefined;
  }

  set genre(value: string | undefined) {
    this.extras = { ...this.extras, genre: value };
  }

  get search(): string | undefined {
    return 'search' in this.extras ? this.extras.search : undefined;
  }

  set search(value: string | undefined) {
    this.extras = { ...this.extras, search: value };
  }

  get skip(): number | undefined {
    return 'skip' in this.extras ? this.extras.skip : undefined;
  }

  set skip(value: number | undefined) {
    this.extras = { ...this.extras, skip: value };
  }

  get date(): string | undefined {
    return 'date' in this.extras ? this.extras.date : undefined;
  }

  set date(value: string | undefined) {
    this.extras = { ...this.extras, date: value };
  }

  public has(key: keyof Extras): boolean {
    return key in this.extras && this.extras[key] !== undefined;
  }

  public toString(): string {
    return Object.entries(this.extras)
      .filter(([_, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
      .join('&');
  }
}
