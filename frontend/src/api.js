import {API_BASE} from './config.js';

export async function apiRequest(path,{method='GET',body,formData,...options}={}) {
  const headers = formData ? {...options.headers} : {'Content-Type':'application/json',...options.headers};
  const verb=method.toUpperCase();
  if(!['GET','HEAD','OPTIONS'].includes(verb)) {
    let csrf;
    try {
      const tokenResponse=await fetch(`${API_BASE}/auth/csrf`,{credentials:'include',cache:'no-store'});
      if(!tokenResponse.ok)throw new Error('Could not obtain CSRF token.');
      csrf=(await tokenResponse.json()).csrfToken;
    }catch {throw new Error('Cannot establish a secure session with the KnowVa backend.');}
    headers['X-CSRF-Token']=csrf;
  }
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      method:verb,
      credentials:'include',
      headers,
      body:formData || (body === undefined ? undefined : JSON.stringify(body))
    });
  } catch {
    throw new Error('Cannot reach the KnowVa backend. Verify the API server and network.');
  }
  const kind = response.headers.get('content-type') || '';
  const payload = kind.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(payload?.message || `Server request failed (${response.status}).`);
  if (!kind.includes('application/json')) {
    if (response.status === 204) return {};
    throw new Error('Expected a JSON response from the KnowVa API.');
  }
  return payload;
}
