// ==UserScript==
// @name         InPlay Schedule Collector (Enhanced)
// @namespace    https://sportarena.win
// @version      1.2
// @description  Improved version that captures all required API data
// @author       Click Clack
// @match        https://www.inplayip.tv/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=inplayip.tv
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      api.inplayip.tv
// @connect      sportarena.win
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        TARGET_API: "https://sportarena.win/collector",
        CACHE_TTL_HOURS: 1,
        DEBUG: true
    };

    // Хранилище для перехваченных данных API
    let apiTemplate = {
        headers: null,
        bodyTemplate: null
    };

    // Перехват всех XHR запросов
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        this._url = url;
        originalXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
        if (this._url.includes('/api/schedule/table')) {
            this.addEventListener('load', () => {
                if (this.status === 200) {
                    // Сохраняем все заголовки и тело запроса
                    apiTemplate = {
                        headers: {
                            'Authorization': this.getResponseHeader('Authorization'),
                            'DeviceUuid': this.getResponseHeader('DeviceUuid'),
                            'Content-Type': 'application/json',
                            'Origin': 'https://www.inplayip.tv',
                            'Referer': 'https://www.inplayip.tv/'
                        },
                        bodyTemplate: JSON.parse(body)
                    };
                    console.log('[InPlay] API template captured', apiTemplate);
                    fetchSchedule();
                }
            });
        }
        originalXHRSend.apply(this, arguments);
    };

    // Получение расписания
    async function fetchSchedule() {
        if (!apiTemplate.headers) {
            console.error('[InPlay] API template not captured yet');
            return;
        }

        const dateKey = new Date().toISOString().split('T')[0];
        const cacheKey = `schedule_${dateKey}`;

        // Проверка кэша
        if (const cachedData = GM_getValue(cacheKey)) {
            console.log('[InPlay] Using cached data');
            sendToTarget(cachedData);
            return;
        }

        // Подготовка тела запроса
        const requestBody = {
            ...apiTemplate.bodyTemplate,
            filters: {
                ...apiTemplate.bodyTemplate.filters,
                searchDate: new Date().toISOString(),
                showLive: true
            }
        };

        try {
            const data = await makeRequest(
                'https://api.inplayip.tv/api/schedule/table',
                apiTemplate.headers,
                requestBody
            );

            if (data?.length > 0) {
                GM_setValue(cacheKey, data, CONFIG.CACHE_TTL_HOURS * 3600);
                sendToTarget(data);
            }
        } catch (error) {
            console.error('[InPlay] API Error:', error);
        }
    }

    // Универсальный запрос
    function makeRequest(url, headers, body) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: url,
                headers: headers,
                data: JSON.stringify(body),
                onload: (response) => {
                    if (response.status === 200) {
                        resolve(JSON.parse(response.responseText));
                    } else {
                        reject(new Error(`HTTP ${response.status}`));
                    }
                },
                onerror: reject
            });
        });
    }

    // Отправка на целевой сервер
    function sendToTarget(data) {
        GM_xmlhttpRequest({
            method: "POST",
            url: CONFIG.TARGET_API,
            headers: {
                "Content-Type": "application/json"
            },
            data: JSON.stringify(data),
            onload: (response) => {
                console.log(`[InPlay] Data sent (${data.length} items)`);
            }
        });
    }

    console.log('[InPlay] Script initialized');
})();
