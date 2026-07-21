import { describe, expect, it } from 'vitest';
import { defaultPaths } from './types.js';
describe('scaffold', () => {
    it('exports defaultPaths', () => {
        expect(defaultPaths.dataDir).toBe('data');
    });
});
