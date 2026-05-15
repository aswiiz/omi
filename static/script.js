document.addEventListener('DOMContentLoaded', () => {
    const micBtn = document.getElementById('mic-btn');
    const chatContainer = document.getElementById('chat-container');
    const welcomeScreen = document.getElementById('welcome');
    const timeDisplay = document.getElementById('time');
    const batteryDisplay = document.getElementById('battery-level');
    const statusBadge = document.getElementById('connection-status');
    
    let isListening = false;
    let sessionId = Math.random().toString(36).substring(7);
    let messages = [];
    let isConnected = false;

    // Connection Logic
    async function checkConnection() {
        try {
            const response = await fetch('/api/health');
            if (response.ok) {
                setConnectionState('connected');
                isConnected = true;
            } else {
                setConnectionState('offline');
                isConnected = false;
            }
        } catch (error) {
            setConnectionState('offline');
            isConnected = false;
        }
    }

    function setConnectionState(state) {
        statusBadge.className = `status-badge ${state}`;
        statusBadge.textContent = state.charAt(0).toUpperCase() + state.slice(1);
        
        if (state === 'offline') {
            micBtn.style.opacity = '0.5';
            micBtn.disabled = true;
        } else {
            micBtn.style.opacity = '1';
            micBtn.disabled = false;
        }
    }

    // Check connection every 5 seconds
    setInterval(checkConnection, 5000);
    checkConnection();

    // Initialize Speech Recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition;

    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            isListening = true;
            micBtn.classList.add('listening');
            console.log('STT started');
        };

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            console.log('User said:', transcript);
            handleUserInput(transcript);
        };

        recognition.onspeechend = () => {
            recognition.stop();
        };

        recognition.onend = () => {
            isListening = false;
            micBtn.classList.remove('listening');
            console.log('STT ended');
        };

        recognition.onerror = (event) => {
            console.error('STT Error:', event.error);
            isListening = false;
            micBtn.classList.remove('listening');
        };
    }

    // Initialize Speech Synthesis
    const synth = window.speechSynthesis;

    function speak(text) {
        if (synth.speaking) {
            synth.cancel();
        }
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.1; // Slightly faster for smartwatch usage
        utterance.pitch = 1.0;
        synth.speak(utterance);
    }

    // UI Logic
    function updateTime() {
        const now = new Date();
        timeDisplay.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    setInterval(updateTime, 1000);
    updateTime();

    if (navigator.getBattery) {
        navigator.getBattery().then(battery => {
            function updateBattery() {
                batteryDisplay.textContent = `${Math.round(battery.level * 100)}%`;
            }
            updateBattery();
            battery.addEventListener('levelchange', updateBattery);
        });
    }

    async function handleUserInput(text) {
        if (!text || !isConnected) return;
        
        if (welcomeScreen) welcomeScreen.classList.add('hidden');
        addMessageToUI('user', text);
        messages.push({ role: 'user', content: text });

        setConnectionState('thinking');

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messages: messages,
                    session_id: sessionId
                }),
            });

            const data = await response.json();
            setConnectionState('connected');
            
            if (data.response) {
                addMessageToUI('ai', data.response);
                messages.push({ role: 'assistant', content: data.response });
                speak(data.response);
            }
        } catch (error) {
            console.error('Error calling AI API:', error);
            setConnectionState('offline');
            addMessageToUI('ai', 'Connection lost. Please check the phone bridge.');
        }
    }

    function addMessageToUI(role, text) {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${role}-bubble`;
        bubble.textContent = text;
        chatContainer.appendChild(bubble);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    micBtn.addEventListener('click', () => {
        if (!isConnected) return;
        if (isListening) {
            recognition.stop();
        } else {
            recognition.start();
        }
    });
});
