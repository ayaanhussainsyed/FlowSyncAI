import requests
from flask import Flask, render_template, request, redirect, url_for, flash, session, jsonify, send_file
from functools import wraps
import os
from openai import OpenAI
import io
import json
import base64
from datetime import datetime
from bson.json_util import dumps
from bson.objectid import ObjectId
import certifi
from pymongo import MongoClient
import numpy as np 
from fpdf import FPDF

app = Flask(__name__)
app.secret_key = '123'
client = MongoClient(
    "uri",
    tls=True,
    tlsCAFile=certifi.where()
)
db = client['NoteSync']
users_collection = db['user_data']
notes_collection = db['notes']
openai_api_key = os.environ.get("api_key")
if not openai_api_key:
    openai_api_key = "key"

if not openai_api_key:
    raise ValueError("api key err.")

openai_client = OpenAI(api_key=openai_api_key)
FINE_TUNED_MODEL_ID = "enter your model file/id"

def login_required(f):
    """Decorator to ensure user is logged in."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'username' not in session:
            flash("Please log in to access this page.", "error")
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

@app.route('/error', methods=['GET'])
def err():
    return render_template('error.html')

@app.route('/sign-up', methods=['GET', 'POST'])
def sign():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        if users_collection.find_one({'username': username}):
            flash('Username already exists. Try another one.', "warning")
            return redirect(url_for('sign'))
        users_collection.insert_one({'username': username, 'password': password})
        print(f"Flask Console: Account created for {username}")
        session['username'] = username
        flash('Account created successfully!', 'success')
        return redirect(url_for('login'))
    return render_template("sign-up.html")

@app.route('/', methods=['GET','POST'])
def login():
    if request.method=="POST":
        username = request.form['username']
        password = request.form['password']
        user = users_collection.find_one({'username': username})
        if user and user['password'] == password:
            session['username'] = username
            flash('Login successful!', 'success')
            return redirect(url_for('home'))
        else:
            flash('Invalid username or password.', "error")
            return redirect(url_for("login"))
    return render_template("login.html")



@app.route('/logout')
@login_required
def logout():
    session.pop('username', None)
    flash("You have been logged out.", "info")
    return redirect(url_for('login'))

@app.route("/home")
@login_required
def home():
    return render_template('home.html')

@app.route('/transcend')
@login_required
def transcend():
    return render_template('transcend.html')

@app.route('/neuralvault')
@login_required
def neuralvault():
    return render_template('neuralvault.html')

@app.route('/transcribe_audio', methods=['POST'])
@login_required
def transcribe_audio():
    if 'audio_file' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400

    audio_file = request.files['audio_file']

    allowed_extensions = {'webm', 'mp3', 'wav', 'm4a', 'mp4', 'aac', 'flac', 'ogg'}
    if '.' not in audio_file.filename or \
       audio_file.filename.rsplit('.', 1)[1].lower() not in allowed_extensions:
        return jsonify({'error': 'Unsupported file format. Please upload a .webm, .mp3, or .wav file.'}), 400

    try:
        audio_bytes = audio_file.read()
        audio_io = io.BytesIO(audio_bytes)
        audio_io.name = audio_file.filename 

        transcript_response = openai_client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_io
        )

        transcript = transcript_response.text
        return jsonify({'transcript': transcript})

    except Exception as e:
        print(f"Error during transcription: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/generate_summary', methods=['POST'])
@login_required
def generate_summary():
    data = request.get_json()
    transcript = data.get('transcript', '')

    if not transcript:
        return jsonify({'error': 'No transcript provided for summarization.'}), 400

    try:
        summary_prompt = (
            "You are an intelligent assistant designed to summarize spoken notes, identify key information, suggest relevant tags, and create a concise title.\n"
            "Your goal is to provide a concise summary, extract any explicit tasks or timeline information, categorize the content with appropriate tags, and generate a brief, descriptive title. IF ANY TYPOS OR WORDS WHICH DON'T MAKE SENSE ARE PRESENT IN THE INPUT, FIX THEM WITH THE MOST RELEVANT WORD.\n"
            "\n"
            "Please analyze the following transcript and return your response in a strict JSON format.\n"
            "The JSON should contain these exact keys:\n"
            "- \"title\": A concise, descriptive title for the note (max 10 words).\n"
            "- \"summary\": A concise summary of the transcript.\n"
            "- \"is_timeline\": boolean (true if the transcript describes a sequence of events, dates, or steps in a clear chronological order or process, false otherwise).\n"
            "- \"detected_tasks\": an array of strings. Each string should be a clearly identified task, action item, or instruction mentioned in the transcript. If no tasks are explicitly mentioned, this array should be empty.\n"
            "- \"tags\": an array of strings. Each string should be a relevant tag for the content (e.g., \"Work\", \"Study\", \"Meeting\", \"Personal\", \"Idea\", \"Literature\", \"History\", \"Science\", \"Programming\", \"Project\"). Limit to 3-5 tags.\n"
            "\n"
            "Example JSON output:\n"
            "{\n"
            "\"title\": \"Meeting Notes on Q3 Planning\",\n"
            "\"summary\": \"This is a summary of the meeting, covering key discussion points.\",\n"
            "\"is_timeline\": true,\n"
            "\"detected_tasks\": [\"Schedule follow-up meeting by Friday\", \"Email report to stakeholders by end of day\"],\n"
            "\"tags\": [\"Meeting\", \"Work\", \"Planning\"]\n"
            "}\n"
            "\n"
            "If no tasks are detected, the \"detected_tasks\" array must be an empty list `[]`.\n"
            "If no relevant tags are found, the \"tags\" array must be an empty list `[]`.\n"
            "The title should be brief and directly reflect the main content.\n"
            "\n"
            "Transcript to process:\n"
            f"{transcript}\n"
        )

        chat_completion = openai_client.chat.completions.create(
            model=FINE_TUNED_MODEL_ID, 
            messages=[
                {"role": "system", "content": "You are a helpful and precise assistant that summarizes text, extracts structured information, generates titles, and provides tags, always responding in valid JSON."},
                {"role": "user", "content": summary_prompt}
            ],
            response_format={"type": "json_object"}
        )

        llm_response_content = chat_completion.choices[0].message.content.strip()

        try:
            parsed_response = json.loads(llm_response_content)
        except json.JSONDecodeError:
            print(f"LLM did not return valid JSON: {llm_response_content}")
            return jsonify({'error': 'AI response could not be parsed. Please try again.'}), 500

        title = parsed_response.get('title', 'Untitled Note')
        summary = parsed_response.get('summary', 'No summary generated.')
        is_timeline = parsed_response.get('is_timeline', False)
        detected_tasks = parsed_response.get('detected_tasks', [])
        tags = parsed_response.get('tags', [])

        return jsonify({
            'title': title,
            'summary': summary,
            'is_timeline': is_timeline,
            'detected_tasks': detected_tasks,
            'tags': tags
        })

    except Exception as e:
        print(f"Error during summary generation: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/save_note', methods=['POST'])
@login_required
def save_note():
    data = request.get_json()
    title = data.get('title')
    transcript = data.get('transcript')
    summary = data.get('summary')
    tags = data.get('tags')
    detected_tasks_raw = data.get('detected_tasks') 
    audio_base64 = data.get('audio_base64')

    if not all([title, transcript, summary, audio_base64]):
        return jsonify({'error': 'Missing data for saving note.'}), 400

    try:
        detected_tasks_for_db = [{"task": task_str, "completed": False} for task_str in detected_tasks_raw]

        note_data = {
            'username': session.get('username'),
            'timestamp': datetime.now(),
            'title': title,
            'transcript': transcript,
            'summary': summary,
            'tags': tags,
            'detected_tasks': detected_tasks_for_db, 
            'audio_base64': audio_base64
        }

        result = notes_collection.insert_one(note_data)
        new_note_id = str(result.inserted_id) 
        print(f"Note saved for {session.get('username')} - Title: {title}, ID: {new_note_id}")
        return jsonify({'message': 'Note saved successfully!', 'noteId': new_note_id}), 200

    except Exception as e:
        print(f"Error saving note: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/update_note', methods=['POST'])
@login_required
def update_note():
    data = request.get_json()
    note_id = data.get('noteId')
    title = data.get('title')
    summary = data.get('summary')
    transcript = data.get('transcript')
    detected_tasks = data.get('detected_tasks')

    if not all([note_id, title, summary, transcript]):
        return jsonify({'error': 'Missing data for updating note.'}), 400

    try:
        if not ObjectId.is_valid(note_id):
            return jsonify({'error': 'Invalid note ID format.'}), 400

        object_note_id = ObjectId(note_id)
        update_fields = {
            'title': title,
            'summary': summary,
            'transcript': transcript,
            'timestamp': datetime.now() 
        }

        if detected_tasks is not None:
            normalized_tasks = []
            for task_item in detected_tasks:
                if isinstance(task_item, dict) and 'task' in task_item:
                    normalized_tasks.append({'task': task_item['task'], 'completed': task_item.get('completed', False)})
                else: 
                    normalized_tasks.append({'task': str(task_item), 'completed': False})
            update_fields['detected_tasks'] = normalized_tasks

        result = notes_collection.update_one(
            {'_id': object_note_id, 'username': session.get('username')},
            {'$set': update_fields}
        )

        if result.matched_count == 0:
            return jsonify({'error': 'Note not found or unauthorized to update.'}), 404
        if result.modified_count == 0:
            return jsonify({'message': 'No changes detected or note already up to date.'}), 200

        print(f"Note updated for {session.get('username')} - ID: {note_id}")
        return jsonify({'message': 'Note updated successfully!'}), 200

    except Exception as e:
        print(f"Error updating note: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/get_note_details/<note_id>', methods=['GET'])
@login_required
def get_note_details(note_id):
    username = session.get('username')
    if not username:
        return jsonify({'error': 'User not logged in.'}), 401

    if not ObjectId.is_valid(note_id):
        return jsonify({'error': 'Invalid note ID format.'}), 400

    try:
        note = notes_collection.find_one({'_id': ObjectId(note_id), 'username': username})

        if note:
            note['_id'] = str(note['_id']) 
            if isinstance(note.get('timestamp'), datetime):
                note['timestamp'] = {'$date': note['timestamp'].isoformat()}

            if 'detected_tasks' in note and isinstance(note['detected_tasks'], list):
                normalized_tasks = []
                for task_item in note['detected_tasks']:
                    if isinstance(task_item, dict) and 'task' in task_item:
                        normalized_tasks.append({'task': task_item['task'], 'completed': task_item.get('completed', False)})
                    else:
                        normalized_tasks.append({'task': str(task_item), 'completed': False})
                note['detected_tasks'] = normalized_tasks
            else:
                note['detected_tasks'] = [] 

            if 'embedding' in note:
                del note['embedding']

            return jsonify({'note': note}), 200
        else:
            return jsonify({'error': 'Note not found or you do not have permission to view it.'}), 404
    except Exception as e:
        print(f"Error fetching note details: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/semantic')
@login_required
def semantic():
    return render_template('semantic.html')

@app.route('/get_user_notes', methods=['GET'])
@login_required
def get_user_notes():
    username = session.get('username')
    if not username:
        return jsonify({'error': 'User not logged in.'}), 401

    try:
        user_notes = list(notes_collection.find({'username': username}, {'embedding': 0}).sort('timestamp', -1))
        for note in user_notes:
            note['_id'] = str(note['_id'])
            if 'audio_base64' in note:
                del note['audio_base64'] 
        return jsonify(user_notes), 200
    except Exception as e:
        print(f"Error fetching user notes: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/get_notes_by_category', methods=['GET'])
@login_required
def get_notes_by_category():
    username = session.get('username')
    category = request.args.get('category')

    if not username:
        return jsonify({'error': 'User not logged in.'}), 401
    if not category:
        return jsonify({'error': 'Category not provided.'}), 400

    try:
        filtered_notes = list(notes_collection.find(
            {'username': username, 'tags': category},
            {'embedding': 0}
        ).sort('timestamp', -1))

        for note in filtered_notes:
            note['_id'] = str(note['_id']) 
            if 'audio_base64' in note:
                del note['audio_base64']
        return jsonify({'notes': filtered_notes}), 200
    except Exception as e:
        print(f"Error fetching notes by category: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/generate_embedding', methods=['POST'])
@login_required
def generate_embedding_route():
    data = request.get_json()
    text = data.get('text')
    note_id = data.get('note_id')

    if not text:
        return jsonify({'error': 'No text provided for embedding.'}), 400

    try:
        response = openai_client.embeddings.create(
            input=text,
            model="text-embedding-3-small" 
        )
        embedding = response.data[0].embedding
        if note_id and ObjectId.is_valid(note_id):
            notes_collection.update_one(
                {'_id': ObjectId(note_id), 'username': session.get('username')},
                {'$set': {'embedding': embedding}}
            )
        return jsonify({'embedding': embedding}), 200

    except Exception as e:
        print(f"Error generating embedding: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/semantic_search', methods=['POST'])
@login_required
def semantic_search():
    data = request.get_json()
    query_text = data.get('query')
    target_note_id = data.get('noteId') 
    num_results = data.get('num_results', 5)

    username = session.get('username')
    if not username:
        return jsonify({'error': 'User not logged in.'}), 401

    try:
        # Corrected projection: only exclude embedding, keep audio_base64
        all_user_notes = list(notes_collection.find({'username': username, 'embedding': {'$exists': True}}, {})) # Fetch all fields including audio_base64 and embedding for processing.
        if not all_user_notes:
            return jsonify({'message': 'No notes with embeddings found for your account.'}), 200

        query_embedding = None
        if query_text:
            query_response = openai_client.embeddings.create(input=query_text, model="text-embedding-3-small")
            query_embedding = query_response.data[0].embedding
        elif target_note_id and ObjectId.is_valid(target_note_id):
            target_note = notes_collection.find_one({'_id': ObjectId(target_note_id), 'username': username})
            if target_note and 'embedding' in target_note:
                query_embedding = target_note['embedding']
            else:
                return jsonify({'error': 'Target note not found or no embedding for it.'}), 404
        else:
            return jsonify({'error': 'Either query text or target note ID must be provided.'}), 400

        if not query_embedding:
            return jsonify({'error': 'Could not generate query embedding.'}), 500

        similarities = []
        for note in all_user_notes:
            if note['_id'] == ObjectId(target_note_id) and target_note_id: 
                continue
            if 'embedding' in note and note['embedding']:
                similarity = np.dot(query_embedding, note['embedding'])
                similarities.append((similarity, note))

        similarities.sort(key=lambda x: x[0], reverse=True)
        top_n_related_notes = [note for _, note in similarities[:num_results]]
        for note in top_n_related_notes:
            note['_id'] = str(note['_id'])
            if 'embedding' in note:
                del note['embedding']
            if 'audio_base64' in note:
                del note['audio_base64']


        return jsonify({'related_notes': top_n_related_notes}), 200

    except Exception as e:
        print(f"Error during semantic search: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/generate_common_topic', methods=['POST'])
@login_required
def generate_common_topic():
    data = request.get_json()
    note_ids = data.get('note_ids', [])

    username = session.get('username')
    if not username:
        return jsonify({'error': 'User not logged in.'}), 401

    if not note_ids:
        return jsonify({'error': 'No note IDs provided.'}), 400

    try:
        object_note_ids = [ObjectId(nid) for nid in note_ids if ObjectId.is_valid(nid)]
        notes_to_analyze = list(notes_collection.find({'_id': {'$in': object_note_ids}, 'username': username}, {'summary': 1, 'title': 1}))

        if not notes_to_analyze:
            return jsonify({'error': 'No valid notes found for the provided IDs.'}), 404

        combined_text = "Following are summaries of several notes:\n"
        for i, note in enumerate(notes_to_analyze):
            combined_text += f"{i+1}. Title: {note.get('title', 'Untitled')}\n   Summary: {note.get('summary', 'No summary.')}\n"

        topic_prompt = (
            "You are an intelligent assistant. Analyze the following collection of note titles and summaries.\n"
            "Your task is to identify the single most prominent common topic or theme that connects these notes.\n"
            "If no strong common topic exists, state \"Miscellaneous\".\n"
            "Return only the common topic as a concise string (e.g., \"Deep Learning\", \"Personal Productivity\", \"Meeting Recaps\").\n"
            "\n"
            f"{combined_text}\n"
            "\n"
            "Common Topic:\n"
        )

        chat_completion = openai_client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a concise AI assistant that identifies the single most prominent common topic from given text, returning only the topic string."},
                {"role": "user", "content": topic_prompt}
            ],
            max_tokens=20 
        )

        common_topic = chat_completion.choices[0].message.content.strip()
        if not common_topic:
            common_topic = "Miscellaneous"

        return jsonify({'common_topic': common_topic}), 200

    except Exception as e:
        print(f"Error generating common topic: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/idrak')
@login_required
def idrak():
    return render_template("idrak.html")

@app.route('/ask_idrak', methods=['POST'])
@login_required
def ask_idrak():
    data = request.get_json()
    user_prompt = data.get('prompt')
    # Receive conversation history
    conversation_history = data.get('history', [])

    if not user_prompt:
        return jsonify({'error': 'No prompt provided.'}), 400

    username = session.get('username')
    if not username:
        return jsonify({'error': 'User not logged in.'}), 401

    try:
        user_notes = list(notes_collection.find({'username': username}, {'title': 1, 'summary': 1, 'transcript': 1}).sort('timestamp', -1))

        context_notes = []
        for note in user_notes:
            note_content = f"Title: {note.get('title', 'Untitled')}\n"
            if note.get('summary'):
                note_content += f"Summary: {note['summary']}\n"
            elif note.get('transcript'): 
                note_content += f"Transcript: {note['transcript']}\n"
            context_notes.append(note_content)
        combined_notes_context = "\n---\n".join(context_notes)
        messages = [
            {"role": "system", "content": (
                "You are an intelligent assistant named Idrak. Your purpose is to answer questions "
                "about the user's notes. You have access to all their notes, including titles, "
                "summaries, and full transcripts. When answering, consolidate information from "
                "relevant notes to provide a comprehensive and helpful response. "
                "If the question cannot be answered from the provided notes, state that. "
                "Be concise but thorough. Maintain context of the previous conversation."
            )},
        ]
        for msg in conversation_history:
            messages.append({"role": msg['role'], "content": msg['content']})
        messages.append({
            "role": "user",
            "content": (
                f"Here are my notes:\n\n{combined_notes_context}\n\n"
                f"My question: {user_prompt}"
            )
        })

        chat_completion = openai_client.chat.completions.create(
            model="gpt-4o",  
            messages=messages
        )

        ai_response = chat_completion.choices[0].message.content.strip()
        return jsonify({'response': ai_response}), 200

    except Exception as e:
        print(f"Error asking Idrak: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/generate_pdf', methods=['POST'])
@login_required
def generate_pdf():
    data = request.get_json()
    conversation_history = data.get('conversation_history', [])
    pdf_prompt = data.get('prompt', "Please compile the conversation into a PDF.") 

    username = session.get('username')
    if not username:
        return jsonify({'error': 'User not logged in.'}), 401

    try:
        pdf_generation_messages = [
            {"role": "system", "content": "You are an assistant that generates content for a PDF document. Based on the provided conversation history and a specific request, compile relevant information into a structured text format suitable for a report or document. If the user asks for questions, generate a list of questions based on the conversation. Focus only on generating the text content for the PDF."},
            {"role": "user", "content": f"Based on this conversation history, {pdf_prompt}:\n\n" + "\n".join([f"{msg['role']}: {msg['content']}" for msg in conversation_history])}
        ]

        pdf_content_completion = openai_client.chat.completions.create(
            model="gpt-4o", 
            messages=pdf_generation_messages,
            max_tokens=1500 
        )
        generated_pdf_text = pdf_content_completion.choices[0].message.content.strip()
        pdf = FPDF()
        pdf.set_auto_page_break(auto=True, margin=15)
        pdf.add_page()
        pdf.set_font("Arial", size=12)
        pdf.set_font("Arial", "B", 16)
        pdf.cell(200, 10, txt="Idrak Conversation Export", ln=True, align="C")
        pdf.ln(10)
        pdf.set_font("Arial", size=12)
        pdf.multi_cell(0, 10, generated_pdf_text)
        pdf_output = pdf.output(dest='S').encode('latin1') 
        return send_file(
            io.BytesIO(pdf_output),
            mimetype='application/pdf',
            as_attachment=True,
            download_name='idrak_conversation.pdf'
        )

    except Exception as e:
        print(f"Error generating PDF: {e}")
        return jsonify({'error': str(e)}), 500


if '__main__' == __name__:
    app.run(debug=True, port=8283)
