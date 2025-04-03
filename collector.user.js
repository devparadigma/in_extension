// ==UserScript==
// @name         InPlay Schedule Collector (Hourly Cache)
// @namespace    https://sportarena.win
// @version      1.7
// @description  Collects schedule data with 1-hour caching
// @author       Click Clack
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
        CACHE_TTL: 3600, // 1 час кэширования (в секундах)
        API_URL: 'https://api.inplayip.tv/api/schedule/table',
        HEADERS_URL: 'https://api.inplayip.tv/api/schedule/stream_settings_aliases',
        TARGET_SERVER: 'https://sportarena.win/collector/index.php'
    };

    // Логирование
    function log(message, isError = false) {
        if (!CONFIG.DEBUG) return;
        const method = isError ? console.error : console.log;
        method(`[InPlay][${new Date().toLocaleTimeString()}] ${message}`);
    }

    // Перехват заголовков
    let authHeaders = null;

    // Модификация XMLHttpRequest
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
                        log('Auth headers captured');
                        processScheduleRequest();
                    }
                });
            }
            return originalSend.apply(this, arguments);
        };
    };

    // Проверка необходимости обновления данных
    const shouldFetchNewData = () => {
        const lastFetchTime = GM_getValue('lastFetchTime', 0);
        const now = Math.floor(Date.now() / 1000);
        return (now - lastFetchTime) > CONFIG.CACHE_TTL;
    };

    // Основная логика обработки расписания
    const processScheduleRequest = async () => {
        if (!authHeaders) {
            log('Auth headers not available', true);
            return;
        }

        const useCache = !shouldFetchNewData();
        const cachedData = GM_getValue('cachedSchedule');

        if (useCache && cachedData) {
            log(`Using cached data (next update in ${getTimeUntilNextFetch()} minutes)`);
            return;
        }

        try {
            log(useCache ? 'Cache expired, fetching new data' : 'Initial data fetch');
            const data = await fetchScheduleData();
            if (data && data.length > 0) {
                GM_setValue('cachedSchedule', data);
                GM_setValue('lastFetchTime', Math.floor(Date.now() / 1000));
                sendToServer(data);
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

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: CONFIG.API_URL,
                headers: authHeaders,
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
                "X-Data-Source": "InPlay Collector"
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

    // Вспомогательная функция для расчета времени до следующего обновления
    const getTimeUntilNextFetch = () => {
        const lastFetchTime = GM_getValue('lastFetchTime', 0);
        const now = Math.floor(Date.now() / 1000);
        const timePassed = now - lastFetchTime;
        return Math.max(0, Math.floor((CONFIG.CACHE_TTL - timePassed) / 60));
    };

    // Инициализация
    setupRequestInterceptor();
    log('Script initialized. Waiting for API calls...');
})();
