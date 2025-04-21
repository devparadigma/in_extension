// ==UserScript==
// @name         InPlay Schedule Collector (Hybrid Auth)
// @namespace    https://sportarena.win
// @version      2.3
// @description  Collects schedule data with dual auth methods
// @author       Click Clack
// @match        https://inplayip.tv/*
// @match        https://www.inplayip.tv/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      api.inplayip.tv
// @connect      sportarena.win
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // Конфигурация
    const CONFIG = {
        DEBUG: true,
        CACHE_TTL: 3600,
        API_URL: 'https://api.inplayip.tv/api/schedule/table',
        HEADERS_URL: 'https://api.inplayip.tv/api/schedule/stream_settings_aliases',
        TARGET_SERVER: 'https://sportarena.win/collector/index.php',
        ALLOWED_DOMAINS: ['inplayip.tv', 'www.inplayip.tv'],
        REFRESH_INTERVAL: 60000
    };

    // Проверка допустимого домена
    const currentDomain = window.location.hostname;
    if (!CONFIG.ALLOWED_DOMAINS.includes(currentDomain)) {
        return;
    }

    // Логирование
    function log(message, isError = false) {
        if (!CONFIG.DEBUG) return;
        const method = isError ? console.error : console.log;
        method(`[InPlay][${currentDomain}][${new Date().toLocaleTimeString()}] ${message}`);
    }

    let authHeaders = null;
    let authToken = null;
    let refreshTimer = null;
    let isInitialFetch = true;

    // 1. Метод перехвата заголовков из XMLHttpRequest (как в старом скрипте)
    const setupRequestInterceptor = () => {
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

        XMLHttpRequest.prototype.headers = {};
        XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
            this.headers[name] = value;
            return originalSetRequestHeader.apply(this, arguments);
        };

        XMLHttpRequest.prototype.open = function(method, url) {
            this._method = method;
            this._url = url;
            return originalOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function(data) {
            if (this._url === CONFIG.HEADERS_URL) {
                this.addEventListener('load', () => {
                    if (this.status === 200) {
                        authHeaders = this.headers;
                        log('Auth headers captured from XHR');
                        if (isInitialFetch) processScheduleRequest();
                    }
                });
            }
            return originalSend.apply(this, arguments);
        };
    };

    // 2. Метод перехвата токена из WebSocket (как в новом скрипте)
    const setupWebSocketInterceptor = () => {
        const nativeWebSocket = window.WebSocket;
        
        window.WebSocket = function(url, protocols) {
            const ws = new nativeWebSocket(url, protocols);
            
            ws.addEventListener('open', () => {
                if (url.includes('api.inplayip.tv/api-hub')) {
                    const tokenMatch = url.match(/access_token=([^&]+)/);
                    if (tokenMatch && tokenMatch[1]) {
                        authToken = tokenMatch[1];
                        log('Auth token captured from WebSocket');
                        if (isInitialFetch) processScheduleRequest();
                    }
                }
            });
            
            return ws;
        };
    };

    // Проверка необходимости обновления данных
    const shouldFetchNewData = () => {
        const lastFetchTime = GM_getValue('lastFetchTime', 0);
        const now = Math.floor(Date.now() / 1000);
        return (now - lastFetchTime) > CONFIG.CACHE_TTL;
    };

    // Основная логика обработки
    const processScheduleRequest = async () => {
        if (!authHeaders && !authToken) {
            log('No auth data available yet', true);
            return;
        }

        const useCache = !isInitialFetch && !shouldFetchNewData();
        const cachedData = GM_getValue('cachedSchedule');

        if (useCache && cachedData) {
            log(`Using cached data (next update in ${getTimeUntilNextFetch()} minutes)`);
            return;
        }

        try {
            log(isInitialFetch ? 'Initial data fetch' : 'Fetching new data');
            const data = await fetchScheduleData();
            if (data && data.length > 0) {
                GM_setValue('cachedSchedule', data);
                GM_setValue('lastFetchTime', Math.floor(Date.now() / 1000));
                sendToServer(data);
                isInitialFetch = false;
            }
        } catch (error) {
            log(`Error: ${error.message}`, true);
        }
    };

    // Получение данных расписания
    const fetchScheduleData = async () => {
        const requestBody = {
            filters: {
                searchDate: new Date().toISOString(),
                searchWord: "",
                onlyNew: false,
                showVOD: false,
                showLive: true,
                sportsCriteria: [],
                countriesCriteria: [],
                servicesCriteria: []
            },
            timezoneOffset: new Date().getTimezoneOffset()
        };

        const headers = authHeaders || {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json'
        };

        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: CONFIG.API_URL,
                headers: headers,
                data: JSON.stringify(requestBody),
                onload: function(response) {
                    if (response.status === 200) {
                        try {
                            resolve(JSON.parse(response.responseText));
                        } catch (e) {
                            reject(new Error('Invalid JSON response'));
                        }
                    } else {
                        reject(new Error(`HTTP ${response.status}`));
                    }
                },
                onerror: reject
            });
        });
    };

    // Отправка данных на сервер
    const sendToServer = (data) => {
        log(`Sending ${data.length} events to server...`);
        
        GM_xmlhttpRequest({
            method: "POST",
            url: CONFIG.TARGET_SERVER,
            headers: {
                "Content-Type": "application/json",
                "X-Data-Source": `InPlay Collector (${currentDomain})`
            },
            data: JSON.stringify(data),
            onload: function(response) {
                if (response.status === 200) {
                    log('Data successfully sent to server');
                } else {
                    log(`Server error: ${response.status}`, true);
                }
            },
            onerror: function(error) {
                log(`Failed to send data: ${error.error}`, true);
            }
        });
    };

    // Вспомогательная функция
    const getTimeUntilNextFetch = () => {
        const lastFetchTime = GM_getValue('lastFetchTime', 0);
        const now = Math.floor(Date.now() / 1000);
        const timePassed = now - lastFetchTime;
        return Math.max(0, Math.floor((CONFIG.CACHE_TTL - timePassed) / 60));
    };

    // Запуск периодического обновления
    const startRefreshCycle = () => {
        if (refreshTimer) clearTimeout(refreshTimer);
        
        processScheduleRequest();
        
        refreshTimer = setTimeout(() => {
            startRefreshCycle();
        }, CONFIG.REFRESH_INTERVAL);
    };

    // Инициализация
    log(`Script initialized for domain: ${currentDomain}`);
    setupRequestInterceptor();
    setupWebSocketInterceptor();
    startRefreshCycle();

    // Очистка
    window.addEventListener('beforeunload', () => {
        if (refreshTimer) clearTimeout(refreshTimer);
    });
})();
