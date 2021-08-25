import axios from 'axios';
import * as vscode from 'vscode';
const Agent = require('agentkeepalive');
const HttpsAgent = require('agentkeepalive').HttpsAgent;

export const getInstance = function(){

  const version = vscode.extensions.getExtension('thinger-io.thinger-io')?.packageJSON.version
  const secure = vscode.workspace.getConfiguration('thinger-io').get('secure');
  
  let axiosInstance = axios.create({
  
    // set user agent and keep-alive
    headers: {
      'User-Agent' : `vscode/${vscode.version} thinger/${version}`,
      'Connection' : 'keep-alive'
    },
  
    //60 sec timeout
    timeout: 60000,

    // configure https agent
    httpsAgent: new HttpsAgent({
      keepAlive: true
    }),
  
    //follow up to 10 HTTP 3xx redirects
    maxRedirects: 10,
    
    //cap the maximum content length we'll accept to 50MBs, just in case
    maxContentLength: 50 * 1000 * 1000,
  });

  // create axios interceptor to automatically set host, port, and authorization
  axiosInstance.interceptors.request.use(async (config: any) => {
    // get current user config
    const host = vscode.workspace.getConfiguration('thinger-io').get('host');
    const port = vscode.workspace.getConfiguration('thinger-io').get('port');
    const secure = vscode.workspace.getConfiguration('thinger-io').get('secure');
    const token = vscode.workspace.getConfiguration('thinger-io').get('token');

    // update axios configuration
    config.baseURL = `https://${host}:${port}`;
    config.httpsAgent.options.rejectUnauthorized = secure;
    config.httpsAgent.options.servername = host;
    config.headers.Authorization = `Bearer ${token}`;

    // debug request
    console.log('Thinger.io Request: ', config)
    return config;    
  });
  
  axiosInstance.interceptors.response.use((response: any) => {
    console.log('Thinger.io Response:', response)
    return response;
  });

  return axiosInstance;
  
}