const userPromptInput = document.getElementById('userPrompt');
const sendButton = document.getElementById('sendButton');
const micButton = document.getElementById('micButton');
const messagesBox = document.getElementById('messagesBox');
const chatPage = document.getElementById('chatPage');
const introSection = document.getElementById('introSection');
const introHeading = document.getElementById('introHeading');

let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let conversationStarted = false;
// Store conversation history
let conversationHistory = []; // [ { role: 'user', content: '...' }, { role: 'assistant', content: '...' } ]

// Auto-resize textarea
userPromptInput.addEventListener('input', () => {
    userPromptInput.style.height = 'auto';
    userPromptInput.style.height = userPromptInput.scrollHeight + 'px';
});

// Function to format AI response text (basic markdown to HTML)
function formatAIResponse(text) {
    // Replace bold (**text**)
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Replace italics (*text*)
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // Replace code blocks (```language\ncode\n```) - non-greedy
    text = text.replace(/```(?:\w+)?\n([\s\S]*?)\n```/g, '<pre><code>$1</code></pre>');
    // Replace inline code (`code`)
    text = text.replace(/`(.*?)`/g, '<code>$1</code>');
    // Replace newlines with paragraphs, but be careful not to break pre/code
    const lines = text.split('\n');
    let formattedHtml = '';
    let inPre = false;
    for (const line of lines) {
        if (line.startsWith('<pre>')) {
            inPre = true;
            formattedHtml += line;
        } else if (line.includes('</pre>')) {
            inPre = false;
            formattedHtml += line;
        } else if (inPre) {
            formattedHtml += line + '\n'; // Preserve newlines within pre tags
        } else if (line.trim() === '') {
            formattedHtml += '<p></p>'; // Add empty paragraph for true line breaks
        } else {
            formattedHtml += `<p>${line}</p>`;
        }
    }
    return formattedHtml;
}


function appendMessage(sender, message, rawMessage = null) {
    if (!conversationStarted) {
        conversationStarted = true;
        chatPage.classList.add('conversation-active');
        messagesBox.classList.add('visible');
        // Adjust intro section margin to move it up
        introSection.style.marginBottom = '20px'; // Smaller margin
        introHeading.style.fontSize = '30px'; // Smaller font
    }

    const messageElement = document.createElement('div');
    messageElement.classList.add('message-bubble', sender === 'user' ? 'user-message' : 'ai-message');

    if (sender === 'ai') {
        messageElement.innerHTML = formatAIResponse(message); // Use innerHTML for formatted text
        conversationHistory.push({ role: 'assistant', content: rawMessage || message });
    } else {
        messageElement.textContent = message; // Use textContent for user input to prevent XSS
        conversationHistory.push({ role: 'user', content: message });
    }

    messagesBox.appendChild(messageElement);
    messagesBox.scrollTop = messagesBox.scrollHeight; // Scroll to bottom
}

async function sendPromptToAI(promptText) {
    appendMessage('user', promptText);
    userPromptInput.value = ''; // Clear input field
    userPromptInput.style.height = '40px'; // Reset textarea height

    // Check if the user is asking for a PDF
    if (promptText.toLowerCase().includes('generate a pdf of questions')) {
        // You can customize what content goes into the PDF
        const pdfContentPrompt = "Please generate a set of questions from our conversation, suitable for a PDF document.";
        generatePdf(conversationHistory, pdfContentPrompt);
        return; // Stop here, don't send to general AI chat
    }

    try {
        const response = await fetch('/ask_idrak', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ prompt: promptText, history: conversationHistory }) // Send full history
        });

        const data = await response.json();
        if (response.ok) {
            appendMessage('ai', data.response, data.response); // Pass raw response to history
        } else {
            appendMessage('ai', `Error: ${data.error || 'Something went wrong.'}`);
            // Don't add error messages to history that would confuse the model
        }
    } catch (error) {
        console.error('Error sending prompt to AI:', error);
        appendMessage('ai', 'Error communicating with the AI. Please try again.');
    }
}

async function generatePdf(history, pdfContentPrompt) {
    try {
        const response = await fetch('/generate_pdf', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ conversation_history: history, prompt: pdfContentPrompt })
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'idrak_questions.pdf'; // Suggested filename
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
            appendMessage('ai', 'Your PDF has been generated and downloaded.');
        } else {
            const errorData = await response.json();
            appendMessage('ai', `PDF Generation Error: ${errorData.error || 'Failed to generate PDF.'}`);
        }
    } catch (error) {
        console.error('Error generating PDF:', error);
        appendMessage('ai', 'An error occurred while generating the PDF.');
    }
}


sendButton.addEventListener('click', () => {
    const promptText = userPromptInput.value.trim();
    if (promptText) {
        sendPromptToAI(promptText);
    }
});

userPromptInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { // Allow Shift+Enter for new line
        e.preventDefault(); // Prevent default Enter behavior (new line)
        const promptText = userPromptInput.value.trim();
        if (promptText) {
            sendPromptToAI(promptText);
        }
    }
});

micButton.addEventListener('click', async () => {
    if (!isRecording) {
        // Start recording
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = (event) => {
                audioChunks.push(event.data);
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const formData = new FormData();
                formData.append('audio_file', audioBlob, 'prompt_audio.webm');

                try {
                    // First, transcribe the audio
                    const transcribeResponse = await fetch('/transcribe_audio', {
                        method: 'POST',
                        body: formData
                    });

                    const transcribeData = await transcribeResponse.json();
                    if (transcribeResponse.ok) {
                        const transcribedText = transcribeData.transcript;
                        if (transcribedText) {
                            sendPromptToAI(transcribedText);
                        } else {
                            appendMessage('ai', 'Could not understand your voice input.');
                        }
                    } else {
                        appendMessage('ai', `Transcription Error: ${transcribeData.error || 'Failed to transcribe audio.'}`);
                    }
                } catch (error) {
                    console.error('Error transcribing audio:', error);
                    appendMessage('ai', 'Error during voice input transcription.');
                }
            };

            mediaRecorder.start();
            micButton.classList.add('recording');
            isRecording = true;
        } catch (err) {
            console.error('Error accessing microphone:', err);
            appendMessage('ai', 'Could not access microphone. Please ensure permissions are granted.');
        }
    } else {
        // Stop recording
        mediaRecorder.stop();
        micButton.classList.remove('recording');
        isRecording = false;
    }
});

document.addEventListener('DOMContentLoaded', () => {
    // No initial message from AI; user initiates the conversation.
});