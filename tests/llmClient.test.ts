import { describe, expect, it, vi } from 'vitest';
import { fetchModelIds, resolveModelsUrl } from '../src/agent/llmClient';

describe('model endpoint helpers', () => {
  it('maps full chat completion endpoints to the models endpoint', () => {
    expect(resolveModelsUrl('https://api.deepseek.com/chat/completions')).toBe('https://api.deepseek.com/models');
    expect(resolveModelsUrl('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/v1/models');
  });

  it('extracts sorted unique model ids', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }, { id: 'deepseek-chat' }] })));
    const models = await fetchModelIds({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test' }, { fetchImpl });
    expect(models).toEqual(['deepseek-chat', 'deepseek-reasoner']);
    expect(fetchImpl).toHaveBeenCalledWith('https://api.example.com/v1/models', expect.objectContaining({ headers: { Authorization: 'Bearer sk-test' } }));
  });
});
