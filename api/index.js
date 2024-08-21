const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const env = require('dotenv');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Message = require('./models/Message');
const ws = require('ws');
const fs = require('fs');

// import {WebSocketServer, WebSocket as ws}  from 'ws';
// import fs from 'fs';
// import { fileURLToPath } from 'url';
// import { dirname } from 'path';



 //const ws = require('ws');




env.config();

mongoose.connect(process.env.MONGO_URL);
const jwtSecret = process.env.JWT_SECRET
const bcryptSalt = bcrypt.genSaltSync(10);
 
const app = express(); 
app.use('/uploads',express.static(__dirname + '/uploads'))
app.use(express.json());
app.use(cookieParser());
app.use(cors({
    credentials: true,
    origin: process.env.CLIENT_URL,
}))

async function getUserDataFromRequest(req) {
    return new Promise((resolve, reject) =>{
        const token = req.cookies?.token;
        if(token){
            jwt.verify(token, jwtSecret, {}, (err, userData)=>{
                if(err) throw err;
                resolve(userData);
            });
        } else{
            reject('no token');
        }
    })
    
}
 
app.get('/test', (req,res)=>{
    res.json('test ok')
});

app.get('/messages/:userId', async(req, res) =>{
    const {userId} = req.params;
    const userData = await getUserDataFromRequest(req);
    const ourUserId = userData.userId;
    const messages = await Message.find({
        sender:{$in:[userId, ourUserId]},
        recipient: {$in: [userId, ourUserId]},
    }).sort({createdAt: 1});
    res.json(messages);
     
});

app.get('/people', async (req, res)=>{
    const users = await User.find({}, {'_id':1, username:1});
    res.json(users);
})

app.get('/profile', (req,res)=>{
    const token = req.cookies?.token;
    if(token){
        jwt.verify(token, jwtSecret, {}, (err, userData)=>{
            if(err) throw err;
            // const {id, username} = userdata;
            res.json(userData)
        });
    } else{
        res.status(401).json('no token')
    }   
});

app.post('/login', async(req, res) =>{
    const {username, password} = req.body;
    const foundUser = await User.findOne({username});
    if(foundUser){
        const passOk = bcrypt.compareSync(password, foundUser.password);
        if(passOk){
            jwt.sign({userId: foundUser._id, username}, jwtSecret , {}, (err, token)=>{
                res.cookie('token', token).status(201).json({
                    id: foundUser._id,
                })
            });
        }
    }

});

app.post('/logout', (req,res) =>{
    res.cookie('token', '' ).json('ok');
})

app.post('/register', async (req, res)=>{
    const {username, password} = req.body;
    try{
        const hashedPassword = bcrypt.hashSync(password);
        const createdUser = await User.create({
            username,
            password: hashedPassword,
        });
        jwt.sign({userId: createdUser._id, username}, jwtSecret , {}, (err, token)=>{
            if(err) throw err;
            res.cookie('token', token).status(201).json({
                id: createdUser._id,
            });
        });
    }
    catch(err){
        if(err) throw err;
        res.status(500).json('error')
    }
    

});

const server = app.listen(4000,()=>{
    console.log("server running on 4000")
})
//BBpsgShoRqFN1Szc

const wss = new ws.WebSocketServer({server});

wss.on('connection', (connection, req) => {

    function notifyAboutOnlinePeople() {
        [...wss.clients].forEach(client =>{
            client.send(JSON.stringify({
                online:[...wss.clients].map(c => ({userId:c.userId, username:c.username})),
            }));
        });
    }

    // Ping 
    connection.isAlive = true;

    connection.timer = setInterval(() => {
        connection.ping();
        connection.deathTimer = setTimeout(() => {
            connection.isAlive = false;
            clearInterval(connection.timer);
            connection.terminate();
            notifyAboutOnlinePeople();
            console.log('dead');

        }, 1000)

    }, 5000);

    connection.on('pong', () => {
        clearTimeout(connection.deathTimer)
    })

    //read username and id form the cookie for this connection
    const cookies = req.headers.cookie;
    if(cookies){
        let tokenCookieStringNew  = cookies.split(';')
        let tokenCookieString;
       tokenCookieStringNew.forEach((s)=>{
            const s1=s.startsWith('token=')
            const s2=s.startsWith(' token=')
            if(s1){
                tokenCookieString=s.split('token=')[1]
            }else{
                tokenCookieString=s.split(' token=')[1]
            }
        })
        if(tokenCookieString){
            const token = tokenCookieString
            if(token){
                jwt.verify(token, jwtSecret, {}, (err, userData)=>{
                    if(err) throw err;
                    const {userId, username} = userData;
                    connection.userId = userId;
                    connection.username = username;

                })
            }
        }
    } 

    connection.on('message', async (message)=>{
        const messageData = JSON.parse(message.toString());
        const {recipient, text, file} = messageData;
        let filename = null;
        if(file) {
            const parts = file.name.split('.');
            const ext = parts[parts.length - 1];
            filename = Date.now() + '.' + ext;
            const path = __dirname + '/uploads/' + filename;
            const bufferData = new Buffer(file.data.split(',')[1], 'base64');
            fs.writeFile(path, bufferData, () => {
                console.log('file saved:'+ path);
            });
        }
        if(recipient && (text || file)) {
            const mesaageDoc = await Message.create({
                sender: connection.userId,
                recipient,
                text,
                file: file ? filename : null,
            });
            console.log('created message');
            [...wss.clients]
             .filter(c => c.userId === recipient)
             .forEach(c => c.send(JSON.stringify({
                text, 
                sender: connection.userId,
                recipient,
                file: file ? filename : null,
                _id: mesaageDoc._id
            })));
        }
        
    });


    //notify everyone about online people when someone connect
    notifyAboutOnlinePeople();
});
