// ==UserScript==
// @name         InPlay Schedule Collector (1-minute refresh)
// @namespace    https://sportarena.win
// @version      2.2
// @description  Collects schedule data every minute with reliable auth
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
        API_URL: 'https://api.inplayip.tv/api/schedule/table',
        TARGET_SERVER: 'https://sportarena.win/collector/index.php',
        ALLOWED_DOMAINS: ['inplayip.tv', 'www.inplayip.tv'],
        REFRESH_INTERVAL: 60000, // 1 минута в миллисекундах
        AUTH_TOKEN: null,
        TOKEN_EXPIRY: 0
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

    let refreshTimer = null;
    let wsInterceptorActive = false;

    // Перехватчик WebSocket для получения токена
    const setupWebSocketInterceptor = () => {
        if (wsInterceptorActive) return;
        wsInterceptorActive = true;

        const nativeWebSocket = window.WebSocket;
        
        window.WebSocket = function(url, protocols) {
            const ws = new nativeWebSocket(url, protocols);
            
            ws.addEventListener('open', () => {
                if (url.includes('api.inplayip.tv/api-hub')) {
                    const tokenMatch = url.match(/access_token=([^&]+)/);
                    if (tokenMatch && tokenMatch[1]) {
                        CONFIG.AUTH_TOKEN = tokenMatch[1];
                        CONFIG.TOKEN_EXPIRY = Date.now() + 3600000; // Токен действителен 1 час
                        log('Auth token successfully extracted from WebSocket');
                        GM_setValue('auth_token', CONFIG.AUTH_TOKEN);
                        GM_setValue('token_expiry', CONFIG.TOKEN_EXPIRY);
                    }
                }
            });
            
            return ws;
        };
    };

    // Попытка получить сохраненный токен
    const loadStoredToken = () => {
        const storedToken = GM_getValue('auth_token');
        const expiry = GM_getValue('token_expiry', 0);
        
        if (storedToken && expiry > Date.now()) {
            CONFIG.AUTH_TOKEN = storedToken;
            CONFIG.TOKEN_EXPIRY = expiry;
            log('Using stored auth token');
            return true;
        }
        return false;
    };

    // Основная функция для получения и отправки данных
    const fetchAndSendData = async () => {
        try {
            // Если токен не загружен и не получен, пытаемся его получить
            if (!CONFIG.AUTH_TOKEN && !loadStoredToken()) {
                setupWebSocketInterceptor();
                log('Waiting for auth token...');
                return;
            }

            log('Fetching fresh data...');
            const data = await fetchScheduleData();
            
            if (data && data.length > 0) {
                GM_setValue('lastData', JSON.stringify(data));
                sendToServer(data);
                log(`Successfully sent ${data.length} events to server`);
            } else {
                log('Received empty data set', true);
            }
        } catch (error) {
            log(`Error: ${error.message}`, true);
            
            // Если ошибка 401, сбрасываем токен
            if (error.message.includes('401')) {
                CONFIG.AUTH_TOKEN = null;
                CONFIG.TOKEN_EXPIRY = 0;
                GM_setValue('auth_token', null);
                GM_setValue('token_expiry', 0);
                log('Auth token expired or invalid, resetting...');
            }
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

        const headers = {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json'
        };

        if (CONFIG.AUTH_TOKEN) {
            headers['Authorization'] = `Bearer ${CONFIG.AUTH_TOKEN}`;
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
                        reject(new Error(`HTTP ${response.status}: ${response.responseText}`));
                    }
                },
                onerror: reject
            });
        });
    };

    // Отправка данных на сервер
    const sendToServer = (data) => {
        GM_xmlhttpRequest({
            method: "POST",
            url: CONFIG.TARGET_SERVER,
            headers: {
                "Content-Type": "application/json",
                "X-Data-Source": `InPlay Collector (${currentDomain})`
            },
            data: JSON.stringify(data),
            onload: function(response) {
                if (response.status !== 200) {
                    log(`Server error: ${response.status}`, true);
                }
            },
            onerror: function(error) {
                log(`Failed to send data: ${error.error}`, true);
            }
        });
    };

    // Запуск периодического обновления
    const startRefreshCycle = () => {
        // Остановить предыдущий таймер, если он был
        if (refreshTimer) {
            clearTimeout(refreshTimer);
        }

        // Выполнить запрос данных
        fetchAndSendData();

        // Установить таймер для следующего обновления
        refreshTimer = setTimeout(() => {
            startRefreshCycle();
        }, CONFIG.REFRESH_INTERVAL);
    };

    // Инициализация
    log(`Script initialized for domain: ${currentDomain}`);
    
    // Загружаем сохраненный токен при старте
    loadStoredToken();
    
    // Устанавливаем перехватчик WebSocket
    setupWebSocketInterceptor();
    
    // Запускаем цикл обновления
    startRefreshCycle();

    // Очистка при уничтожении страницы
    window.addEventListener('beforeunload', () => {
        if (refreshTimer) {
            clearTimeout(refreshTimer);
        }
        wsInterceptorActive = false;
    });
})();
