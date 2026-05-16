document.addEventListener('DOMContentLoaded', () => {
    const micBtn = document.getElementById('mic-btn');
    const chatContainer = document.getElementById('chat-container');
    const welcomeScreen = document.getElementById('welcome');
    const timeDisplay = document.getElementById('time');
    const batteryDisplay = document.getElementById('battery-level');
    const statusBadge = document.getElementById('connection-status');
    const continuousToggle = document.getElementById('continuous-toggle');
    const navChat = document.getElementById('nav-chat');
    const navMemory = document.getElementById('nav-memory');
    const chatView = document.getElementById('chat-view');
    const memoryView = document.getElementById('memory-view');
    const memoryList = document.getElementById('memory-list');
    
    let isListening = false;
    let isContinuous = false;
    let sessionId = Math.random().toString(36).substring(7);
    let messages = [];
    let isConnected = false;
    let silenceTimer = null;
    const SILENCE_THRESHOLD = 30000; // 30 seconds of silence triggers summarization

    // Tab Switching
    navChat.addEventListener('click', () => {
        navChat.classList.add('active');
        navMemory.classList.remove('active');
        chatView.classList.remove('hidden');
        memoryView.classList.add('hidden');
    });

    navMemory.addEventListener('click', () => {
        navMemory.classList.add('active');
        navChat.classList.remove('active');
        memoryView.classList.remove('hidden');
        chatView.classList.add('hidden');
        fetchMemories();
    });

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

    setInterval(checkConnection, 5000);
    checkConnection();

    // Speech Recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition;

    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.lang = 'en-US';
        recognition.interimResults = true;

        recognition.onstart = () => {
            isListening = true;
            micBtn.classList.add('listening');
            document.getElementById('listening-indicator').classList.remove('hidden');
            document.getElementById('transcription-display').classList.remove('hidden');
        };

        recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }

            if (finalTranscript) {
                handleUserInput(finalTranscript);
                resetSilenceTimer();
            }

            document.getElementById('live-transcript').textContent = interimTranscript || finalTranscript;
        };

        recognition.onend = () => {
            if (isContinuous && isConnected) {
                recognition.start();
            } else {
                isListening = false;
                micBtn.classList.remove('listening');
                document.getElementById('listening-indicator').classList.add('hidden');
                document.getElementById('transcription-display').classList.add('hidden');
            }
        };

        recognition.onerror = (event) => {
            console.error('STT Error:', event.error);
            if (event.error !== 'no-speech') {
                isListening = false;
                micBtn.classList.remove('listening');
            }
        };
    }

    // Silence detection for auto-summarization
    function resetSilenceTimer() {
        if (silenceTimer) clearTimeout(silenceTimer);
        if (isContinuous && messages.length > 0) {
            silenceTimer = setTimeout(triggerSummarization, SILENCE_THRESHOLD);
        }
    }

    async function triggerSummarization() {
        if (messages.length < 2) return; // Need at least some interaction
        
        console.log('Triggering auto-summarization...');
        try {
            const response = await fetch('/api/summarize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages, session_id: sessionId })
            });
            if (response.ok) {
                console.log('Summarization successful');
                // Clear messages for next "session" in continuous mode
                messages = [];
                sessionId = Math.random().toString(36).substring(7);
            }
        } catch (error) {
            console.error('Summarization failed:', error);
        }
    }

    // Speech Synthesis
    const synth = window.speechSynthesis;
    function speak(text) {
        if (synth.speaking) synth.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.1;
        synth.speak(utterance);
    }

    // UI Logic
    function updateTime() {
        const now = new Date();
        timeDisplay.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    setInterval(updateTime, 1000);
    updateTime();

    async function handleUserInput(text) {
        if (!text || !isConnected) return;
        
        if (welcomeScreen) welcomeScreen.classList.add('hidden');
        addMessageToUI('user', text);
        messages.push({ role: 'user', content: text });

        setConnectionState('thinking');

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: messages, session_id: sessionId }),
            });

            const data = await response.json();
            setConnectionState('connected');
            
            if (data.response) {
                addMessageToUI('ai', data.response);
                messages.push({ role: 'assistant', content: data.response });
                speak(data.response);
            }
        } catch (error) {
            setConnectionState('offline');
            addMessageToUI('ai', 'Connection lost.');
        }
    }

    function addMessageToUI(role, text) {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${role}-bubble`;
        bubble.textContent = text;
        chatContainer.appendChild(bubble);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    async function fetchMemories() {
        try {
            const response = await fetch('/api/memories');
            const memories = await response.json();
            renderMemories(memories);
        } catch (error) {
            console.error('Error fetching memories:', error);
        }
    }

    function renderMemories(memories) {
        if (memories.length === 0) {
            memoryList.innerHTML = '<div class="empty-state">No memories yet.</div>';
            return;
        }

        memoryList.innerHTML = memories.map(m => `
            <div class="memory-card">
                <span class="timestamp">${m.timestamp}</span>
                <p class="summary">${m.summary}</p>
                ${m.action_items.length > 0 ? `
                    <ul class="action-items">
                        ${m.action_items.map(item => `<li>${item}</li>`).join('')}
                    </ul>
                ` : ''}
            </div>
        `).join('');
    }

    micBtn.addEventListener('click', () => {
        if (!isConnected) return;
        if (isListening) {
            isContinuous = false;
            continuousToggle.checked = false;
            recognition.stop();
        } else {
            recognition.start();
        }
    });

    continuousToggle.addEventListener('change', (e) => {
        isContinuous = e.target.checked;
        if (isContinuous && !isListening) {
            recognition.start();
        } else if (!isContinuous && isListening) {
            recognition.stop();
        }
    });
});
