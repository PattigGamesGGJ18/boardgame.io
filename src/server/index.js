/*
 * Copyright 2017 The boardgame.io Authors
 *
 * Use of this source code is governed by a MIT-style
 * license that can be found in the LICENSE file or at
 * https://opensource.org/licenses/MIT.
 */

const Koa = require('koa');
const IO = require('koa-socket');
const Redux = require('redux');
const crypto = require('crypto');
const _ = require('lodash');
import { InMemory } from './db';
import { createGameReducer } from '../core/reducer';

function Server({ games, db }) {
  const app = new Koa();
  const io = new IO();
  app.context.io = io;
  io.attach(app);

  if (db === undefined) {
    db = new InMemory();
  }

  const clientInfo = new Map();
  const roomInfo = new Map();

  for (const game of games) {
    const nsp = app._io.of(game.name);

    nsp.on('connection', socket => {
      socket.on('action', (action, stateID, gameID, playerID) => {
        const store = db.get(gameID);

        if (store === undefined) {
          return { error: 'game not found' };
        }

        const state = store.getState();

        // The null player is a view-only player.
        if (playerID == null) {
          return;
        }

        // Bail out if the player making the move is not
        // the current player.
        if (
          state.ctx.currentPlayer != 'any' &&
          playerID != state.ctx.currentPlayer
        ) {
          return;
        }

        if (state._id == stateID) {
          // Update server's version of the store.
          store.dispatch(action);
          const state = store.getState();

          // Get clients connected to this current game.
          const roomClients = roomInfo.get(gameID);
          for (const client of roomClients.values()) {
            const playerID = clientInfo.get(client);

            if (client === socket.id) {
              socket.emit('sync', gameID, {
                ...state,
                G: game.playerView(state.G, state.ctx, playerID),
              });
            } else {
              socket.to(client).emit('sync', gameID, {
                ...state,
                G: game.playerView(state.G, state.ctx, playerID),
              });
            }
          }

          db.set(gameID, store);
        }
      });

      socket.on('sync', (playerName, gameID, playerID, numPlayers) => {
        const joining = gameID === null;

        if (joining) {
          console.log(
            'User ' + playerName + ' wants to join a ' + game.name + ' game.'
          );

          for (let [key, value] of roomInfo.entries()) {
            if (value.size < game.maxPlayers) {
              gameID = key;
              break;
            }
          }

          if (!gameID) {
            const hash = crypto
              .createHash('sha1')
              .update(new Date().toString())
              .digest('hex');
            gameID = game.name + '_' + hash;
          }
        }

        socket.join(gameID);

        let roomClients = roomInfo.get(gameID);
        if (roomClients === undefined) {
          roomClients = new Set();
          roomInfo.set(gameID, roomClients);
        }
        roomClients.add(socket.id);

        if (joining) {
          console.log('User ' + playerName + ' will join ' + gameID);

          // create playerid for roominfo of gameid
          const players = _.map([...roomClients], c => {
            // it's me, hooray....
            if (c === socket.id) {
              return -1; // default to invalid player id
            }
            return clientInfo.get(c).playerID;
          });
          playerID = _.max([...players]) + 1; // a -1 will turn to 0 here
          console.log(
            'Assigning user ' + playerName + ' playerID ' + playerID + '.'
          );

          // publish the matchmaking result to the client
          socket.emit('join', gameID, playerID);
        }

        // store playerid for client in clientinfo
        clientInfo.set(socket.id, { gameID, playerID });

        let store = db.get(gameID);
        if (store === undefined) {
          const reducer = createGameReducer({ game, numPlayers });
          store = Redux.createStore(reducer);
          db.set(gameID, store);
        }

        const state = store.getState();
        socket.emit('sync', gameID, {
          ...state,
          G: game.playerView(state.G, state.ctx, playerID),
        });
      });

      socket.on('disconnect', () => {
        clientInfo.delete(socket.id);
      });
    });
  }

  return app;
}

export default Server;
