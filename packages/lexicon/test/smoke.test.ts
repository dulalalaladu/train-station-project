import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from '../src/index';

describe('@railvoice/lexicon skeleton', () => {
  it('loads and identifies itself', () => {
    expect(PACKAGE_NAME).toBe('@railvoice/lexicon');
  });
});
