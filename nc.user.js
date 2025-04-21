// ==UserScript==
// @name         InPlay Schedule Collector (Multi-Domain) - Auto Refresh
// @namespace    https://sportarena.win
// @version      1.9
// @description  Collects schedule data with 1-hour caching for both domains (auto-refreshing)
// @author       Click Clack
// @match        https://inplayip.tv/*
// @match        https://www.inplayip.tv/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
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
        TARGET_SERVER: 'https://sportarena.win/collector/index.php',
        ALLOWED_DOMAINS: ['inplayip.tv', 'www.inplayip.tv'],
        REFRESH_INTERVAL: 3600000 // 1 час в миллисекундах
    };

    // Проверка допустимого домена
    const currentDomain = window.location.hostname;
    if (!CONFIG.ALLOWED_DOMAINS.includes(currentDomain)) {
        return;
    }

    // Логирование с указанием домена
    function log(message, isError = false) {
        if (!CONFIG.DEBUG) return;
        const method = isError ? console.error : console.log;
        method(`[InPlay][${currentDomain}][${new Date().toLocaleTimeString()}] ${message}`);
    }

    // Перехват заголовков
    let authHeaders = null;
    let refreshTimer = null;
    let isInitialFetch = true;

    // Основная функция для получения данных
    const fetchData = async () => {
        try {
            // Если это первый запрос или заголовки утеряны, получаем их
            if (isInitialFetch || !authHeaders) {
                await fetchAuthHeaders();
            }

            // Проверяем, нужно ли обновлять данные
            if (isInitialFetch || shouldFetchNewData()) {
                log(isInitialFetch ? 'Initial data fetch' : 'Cache expired, fetching new data');
                const data = await fetchScheduleData();
                if (data && data.length > 0) {
                    GM_setValue('cachedSchedule', data);
                    GM_setValue('lastFetchTime', Math.floor(Date.now() / 1000));
                    sendToServer(data);
                }
                isInitialFetch = false;
            } else {
                log(`Using cached data (next update in ${getTimeUntilNextFetch()} minutes)`);
            }
        } catch (error) {
            log(`Error: ${error.message}`, true);
        }
    };

    // Получение auth headers через прямой запрос
    const fetchAuthHeaders = () => {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: CONFIG.HEADERS_URL,
                onload: function(response) {
                    if (response.status === 200) {
                        // Сохраняем заголовки, которые использовались в запросе
                        authHeaders = {
                            'Accept': 'application/json, text/plain, */*',
                            'Content-Type': 'application/json',
                            // Добавьте другие необходимые заголовки, если они известны
                        };
                        log('Auth headers obtained');
                        resolve();
                    } else {
                        reject(new Error(`Failed to get auth headers: HTTP ${response.status}`));
                    }
                },
                onerror: function(error) {
                    reject(new Error(`Failed to get auth headers: ${error.error}`));
                }
            });
        });
    };

    // Проверка необходимости обновления данных
    const shouldFetchNewData = () => {
        const lastFetchTime = GM_getValue('lastFetchTime', 0);
        const now = Math.floor(Date.now() / 1000);
        return (now - lastFetchTime) > CONFIG.CACHE_TTL;
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

    // Вспомогательная функция для расчета времени до следующего обновления
    const getTimeUntilNextFetch = () => {
        const lastFetchTime = GM_getValue('lastFetchTime', 0);
        const now = Math.floor(Date.now() / 1000);
        const timePassed = now - lastFetchTime;
        return Math.max(0, Math.floor((CONFIG.CACHE_TTL - timePassed) / 60));
    };

    // Запуск периодического обновления
    const startRefreshCycle = () => {
        // Остановить предыдущий таймер, если он был
        if (refreshTimer) {
            clearTimeout(refreshTimer);
        }

        // Выполнить запрос данных
        fetchData();

        // Установить таймер для следующего обновления
        refreshTimer = setTimeout(() => {
            startRefreshCycle();
        }, CONFIG.REFRESH_INTERVAL);
    };

    // Инициализация
    log(`Script initialized for domain: ${currentDomain}`);
    startRefreshCycle();

    // Очистка при уничтожении страницы (опционально)
    window.addEventListener('beforeunload', () => {
        if (refreshTimer) {
            clearTimeout(refreshTimer);
        }
    });
})();
