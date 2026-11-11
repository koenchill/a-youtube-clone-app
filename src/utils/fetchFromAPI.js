import axios from 'axios';

// The browser calls our server. No provider credential enters the React bundle.
export const BASE_URL = '/api/youtube';
export const fetchFromAPI = async (url) => {
  const { data } = await axios.get(`${BASE_URL}/${url}`, {
    params: { maxResults: 25 }, timeout: 12000,
  });
  return data;
};
