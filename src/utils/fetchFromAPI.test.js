import axios from 'axios';
import { BASE_URL, fetchFromAPI } from './fetchFromAPI';
jest.mock('axios');
test('uses same origin without a browser API key', async () => {
  axios.get.mockResolvedValue({ data: { items: [{ id: 'one' }] } });
  expect(BASE_URL).toBe('/api/youtube');
  await expect(fetchFromAPI('search?q=Linux')).resolves.toEqual({ items: [{ id: 'one' }] });
  expect(axios.get).toHaveBeenCalledWith('/api/youtube/search?q=Linux', {
    params: { maxResults: 25 }, timeout: 12000,
  });
});
test('propagates network errors to the caller', async () => {
  axios.get.mockRejectedValue(new Error('upstream unavailable'));
  await expect(fetchFromAPI('search?q=Linux')).rejects.toThrow('upstream unavailable');
});
