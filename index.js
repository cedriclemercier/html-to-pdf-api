const express = require('express');
const multer = require('multer');
const puppeteer = require('puppeteer');
const upload = multer();
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();
require('dotenv').config()
const port = process.env.PORT || 5555; // Change the port if needed
const { EventEmitter } = require('events'); // Import EventEmitter

// Middleware to enable CORS
app.use(cors());

// Middleware to parse FormData
app.use(upload.any());

// Create an EventEmitter instance
const eventEmitter = new EventEmitter();

// ================================================ helper functions =======================================================
function getRandomImage(images) {
  const filteredImages = images.filter(
    (image) => !image.endsWith(".ttf") && !image.endsWith(".svg")
  );

  let randomIndex = Math.floor(Math.random() * filteredImages.length);
  while (filteredImages[randomIndex].includes('bg') || filteredImages[randomIndex].includes('background') || filteredImages[randomIndex].includes('logo')) {
    console.log(`Index has bg or background in name, picking another!`);
    randomIndex = Math.floor(Math.random() * filteredImages.length);
  }

  return filteredImages[randomIndex];
}
function replaceImagePlaceholder(str, imageFiles) {
  return str.replace(/\{image\}/g, function () {
    // Select a random image from imageFiles
    return getRandomImage(imageFiles);
  });
}

function replaceImgToBase64(htmlString, imageFiles, files) {
  let content = htmlString;
  for (const file of files) {
    if (file.fieldname.endsWith('.jpg') || file.fieldname.endsWith('.png')) {
      const imageBase64 = `data:image/${path.extname(file.fieldname).substring(1)};base64,${file.buffer.toString('base64')}`;
      // Replace background-image: url() values with base64
      content = content.replace(new RegExp(`url\\(['"]?${file.fieldname}['"]?\\)`, 'g'), `url('${imageBase64}')`);
      // Replace img src values with base64
      content = content.replace(new RegExp(`src=['"]?${file.fieldname}['"]?`, 'g'), `src="${imageBase64}"`);
    }
  }
  return content;
}
// =======================================================================================================



// Endpoint to subscribe to logs via SSE
app.get('/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send new log messages as SSE
  const listener = (message) => {
    res.write(`${ message }\n\n`);
  };
  eventEmitter.on('log', listener);

  // Remove the listener when the client closes the connection
  req.on('close', () => {
    eventEmitter.off('log', listener);
  });
});

// Function to emit log messages
function logToUI(message) {
  const dateTime = new Date().toLocaleString(); // Get current date and time in a nicely formatted string
  const logMessage = `[${dateTime}] ${message}`; // Prepend date and time to the log message
  eventEmitter.emit('log', logMessage);
}

app.get('/', (req, res) => {
  res.status(200).send('API is working! Go to /logs to view logs')
})

  // Endpoint to read test.pdf file and send it as a blob
app.get('/test-pdf', (req, res) => {
    const filePath = path.join(__dirname, 'pdf-preview-2.pdf');
    
    // Check if the file exists
    if (fs.existsSync(filePath)) {
      // Read the file
      fs.readFile(filePath, (err, data) => {
        if (err) {
          console.error('Error reading file:', err);
          res.status(500).send('Error reading file');
        } else {
          // Set content type header to indicate that a PDF blob is being sent
          res.set('Content-Type', 'application/pdf');
          console.log('sending!');
          // Send the file data as a blob
          res.send(data);
        }
      });
    } else {
      res.status(404).send('File not found');
    }
  });


// Endpoint to handle FormData and generate PDF from HTML code
app.post('/make-pdf', async (req, res) => {
  // Find the Blob data for "page.html"
  const pageHtmlBlob = req.files.find(file => file.fieldname === 'page.html');

  if (pageHtmlBlob) {
    logToUI(`Found page.html. Getting files...`);
    try {
      const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'], ignoreDefaultArgs: ['--disable-extensions'] });
      const page = await browser.newPage();
      
      let pageHtmlString = pageHtmlBlob.buffer.toString('utf-8');
      let cssCode = '';

      // Iterate through files to find CSS files
      let i = 0;
      for (const file of req.files) {
        if (file.fieldname.endsWith('.css')) {
          console.log(`File ${i}: ${file.fieldname}`);
          logToUI(`Found: File ${i}: ${file.fieldname}`);
          i++;
          // Read CSS file content as string
          const cssContent = file.buffer.toString('utf-8');
          // Concatenate CSS code
          cssCode += cssContent;
        } 
      }
      // Replace {style} with CSS code
      pageHtmlString = pageHtmlString.replace('{style2}', `<style>${cssCode}</style>`);

      // Take care of replacing images with base64
      logToUI(`Replacing images...`);
      let imagesArray = []
      for (const file of req.files) {
        if (file.fieldname.endsWith('.jpg') || file.fieldname.endsWith('.png')) {
          imagesArray.push(file.fieldname)
          // Read image file content as base64
          const imageBase64 = `data:image/${path.extname(file.fieldname).substring(1)};base64,${file.buffer.toString('base64')}`;
          // Replace background-image: url() values with base64
          pageHtmlString = pageHtmlString.replace(new RegExp(`url\\(['"]?${file.fieldname}['"]?\\)`, 'g'), `url('${imageBase64}')`);
          // Replace img src values with base64
          pageHtmlString = pageHtmlString.replace(new RegExp(`src=['"]?${file.fieldname}['"]?`, 'g'), `src="${imageBase64}"`);
        }
      }

      // Replace cover page image. TODO: All in one code with the lines above
      pageHtmlString = replaceImagePlaceholder(pageHtmlString, imagesArray);
      pageHtmlString = replaceImgToBase64(pageHtmlString, imagesArray, req.files)

      await page.setContent(pageHtmlString);
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        landscape: true,
        margin: {
          left: '0px',
          top: '0px',
          right: '0px',
          bottom: '0px'
        }
      });

      // Save the PDF file (optional)
      if (process.env.ENVIRONMENT && process.env.ENVIRONMENT == 'dev') {
        console.log(`Saving to files: output.html and output.pdf !`);
        fs.writeFileSync('output.html', pageHtmlString);
        fs.writeFileSync('output.pdf', pdfBuffer);
      }

      // Set the content type header to indicate that a PDF blob is being sent in the response
      res.set('Content-Type', 'application/pdf');
      logToUI(`Done.`);
      console.log('All done!');
      res.send(pdfBuffer);
    } catch (error) {
      logToUI(`Error generating PDF: ${error}`);
      console.error('Error generating PDF:', error);
      res.status(500).send('Error generating PDF');
    }
  } else {
    res.status(404).send('page.html not found in FormData');
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is listening at http://localhost:${port}`);
});
