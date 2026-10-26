// Test-only transport failure. Never replaces AI output or database observations.
const fetchWithNetwork = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = input instanceof globalThis.Request ? input.url : String(input);
  if (url.startsWith('http://127.0.0.1:11434/'))
    return Promise.reject(new TypeError('Test-only Ollama endpoint loss'));
  return fetchWithNetwork(input, init);
};
