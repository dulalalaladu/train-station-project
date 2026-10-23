import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from '../src/index';

describe('@railvoice/mock-xfyun skeleton', () => {
  it('loads and identifies itself', () => {
    expect(PACKAGE_NAME).toBe('@railvoice/mock-xfyun');
  });
});
