# Carve 4 Cancer Raffle Web Application

A web application for managing raffle items at the Carve 4 Cancer event (ski, snowboard, music festival).

## Features

- **Public Display Page**: Shows all raffle items with images, descriptions, and winning numbers
- **Admin Panel**: Password-protected page for managing raffle items and winning numbers
- **Search Functionality**: Live search on both public and admin pages
- **Ticket Checker**: Users can enter their ticket numbers to see if they won
- **Drag & Drop Reordering**: Admins can reorder raffle items with drag and drop
- **Image Upload**: Upload from file or paste image URL from Google Images
- **Automatic Updates**: Display page refreshes every 30 seconds to show latest winners
- **Mobile-First Design**: Fully responsive on all devices with touch-friendly controls
- **Editable Rules**: Admins can update raffle rules and information

## Installation

1. Make sure you have Node.js installed (version 14 or higher)
2. Navigate to the project directory
3. Install dependencies:
   ```bash
   npm install
   ```

## Running the Application

Start the server:
```bash
npm start
```

For development with auto-restart:
```bash
npm run dev
```

The application will be available at: `http://localhost:3000`

## Default Credentials

**Admin Account:**
- Username: `admin`
- Password: `carve4cancer`

**IMPORTANT:** Change this default password before your event!

## Changing Passwords

To change passwords, you can use the API endpoint or modify the `data/users.json` file after first run.

## Usage

### For Event Attendees (Public)
- Visit `http://localhost:3000` to view all raffle items and winning numbers
- Use the search bar to find specific items
- Enter your ticket numbers to see if you won

### For Admins (Managing Raffle Items)
1. Go to `http://localhost:3000/admin.html`
2. Login with admin credentials
3. **Add New Raffle Items:**
   - Fill out the form with item name, description, and upload an image
   - Click "Add Raffle Item"
4. **Update Winning Numbers:**
   - Scroll to the "Current Raffle Items" section
   - Enter the winning number in the input field for each item
   - Click "Set Winner" or "Update Winner"
5. **Edit Items:**
   - Click the "Edit" button on any item
   - Update the name, description, or image
   - Click "Update Raffle Item"
6. **Delete Items:**
   - Click the "Delete" button on any item
   - Confirm deletion
7. All changes appear on the public display page immediately

## File Structure

```
C4C_RaffleWebApp/
├── server.js           # Express server and API endpoints
├── package.json        # Dependencies and scripts
├── data/              # Database files (auto-created)
│   ├── raffles.json   # Raffle items data
│   └── users.json     # User credentials
├── uploads/           # Uploaded raffle images (auto-created)
└── public/            # Web pages and assets
    ├── index.html     # Public raffle display
    ├── admin.html     # Admin panel
    ├── volunteer.html # Volunteer panel
    └── styles.css     # Styling
```

## Deployment to Vercel

This app is configured for easy deployment to Vercel:

1. **Push to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```

2. **Deploy to Vercel:**
   - Go to [vercel.com](https://vercel.com)
   - Click "Import Project"
   - Import your GitHub repository
   - Vercel will automatically detect the configuration
   - Click "Deploy"

3. **Important Notes for Vercel:**
   - Data and uploads will be **temporary** on Vercel (serverless functions are stateless)
   - For production use, consider using:
     - Vercel Blob Storage or AWS S3 for images
     - A database service like MongoDB Atlas or PostgreSQL for raffle data
   - **Change the default password immediately** after deployment

## Alternative Deployment Options

For persistent storage, consider:
- **Heroku**: Persistent filesystem, easy deployment
- **DigitalOcean**: Full VPS control
- **Railway**: Simple deployment with persistent storage
- **Render**: Free tier with persistent storage

## Data Persistence

All raffle data and images are stored locally:
- Raffle information: `data/raffles.json`
- User credentials: `data/users.json`
- Images: `uploads/` directory

Make sure to backup these directories before the event!

## Troubleshooting

**Server won't start:**
- Make sure port 3000 is available
- Check that all dependencies are installed

**Images not uploading:**
- Check that the `uploads/` directory exists and is writable
- Verify image size is under 5MB
- Only JPEG, JPG, PNG, and GIF formats are supported

**Can't login:**
- Verify you're using the correct username and password
- Check the console for any error messages

## Support

For issues or questions about this application, please contact your technical support team.

## License

MIT
