# Lovify Game

## Overview
Lovify Game is an interactive quiz game designed for couples, where players answer questions about each other and guess their partner's responses. The game encourages communication and fun, making it a perfect activity for date nights or virtual hangouts.

## Features
- Private shared session for exactly two connected users.
- Login protected by the shared password `euteamoleide`.
- Answer questions and guess partner's responses.
- Real-time chat functionality for players.
- Live player list in the Games and List tabs.
- Upload and share files during the game.
- Responsive design for various devices.

## Project Structure
```
lovify-game
├── app.py                # Main application file with Flask server and game logic
├── data
│   ├── questions.json    # JSON file containing quiz questions
│   ├── used.json         # JSON file tracking used questions per room
│   └── uploads           # Directory for storing uploaded files
├── static
│   ├── app.js            # Client-side JavaScript for user interactions
│   └── style.css         # CSS styles for the frontend
├── templates
│   └── index.html        # Main HTML template for the application
├── README.md             # Project documentation
├── requirements.txt      # Python dependencies
└── .gitignore            # Files and directories to ignore in Git
```

## Installation
1. Clone the repository:
   ```
   git clone https://github.com/yourusername/lovify-game.git
   cd lovify-game
   ```

2. Install the required dependencies:
   ```
   pip install -r requirements.txt
   ```

3. Ensure you have the necessary environment variables set up, particularly `SECRET_KEY`.

## Running the Application
To start the application, run:
```
python app.py
```
The server will start on `http://localhost:5000` by default.

## Usage
1. Open your web browser and navigate to `http://localhost:5000`.
2. Enter your name and the shared password `euteamoleide`.
3. Wait for the second player, then open **Perguntas** from the Games tab.

## Contributing
Contributions are welcome! Please open an issue or submit a pull request for any enhancements or bug fixes.

## License
This project is licensed under the MIT License. See the LICENSE file for details.

## Acknowledgments
- Flask and Flask-SocketIO for the backend framework.
- Socket.IO for real-time communication.
- All contributors who help improve the project.