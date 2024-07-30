import axios from 'axios';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const newRequest = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

export default newRequest;