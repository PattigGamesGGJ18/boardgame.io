/*
 * Copyright 2017 The boardgame.io Authors
 *
 * Use of this source code is governed by a MIT-style
 * license that can be found in the LICENSE file or at
 * https://opensource.org/licenses/MIT.
 */

import { MAKE_MOVE, GAME_EVENT } from '../../core/action-types';
import * as ActionCreators from '../../core/action-creators';
import { createStore, applyMiddleware } from 'redux';
import io from 'socket.io-client';

/**
 * Multiplayer
 *
 * Handles all the multiplayer interactions on the client-side.
 */
export class Multiplayer {
  /**
   * Creates a new Mutiplayer instance.
   * @param {object} socketImpl - Override for unit tests.
   * @param {string} gameID - The game ID to connect to.
   * @param {string} playerName - The player name associated with this client.
   * @param {string} gameName - The game type (the `name` field in `Game`).
   * @param {string} numPlayers - The number of players.
   * @param {string} server - The game server in the form of 'hostname:port'. Defaults to the server serving the client if not provided.
   */
  constructor(socketImpl, gameID, playerName, gameName, numPlayers, server) {
    this.gameName = gameName || 'default';
    this.playerName = playerName || 'Player 1';
    this.gameID = null;
    this.playerID = null;
    this.numPlayers = numPlayers || 2;
    this.joined = new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });

    if (socketImpl !== undefined) {
      this.socket = socketImpl;
    } else {
      if (server) {
        this.socket = io('http://' + server + '/' + gameName);
      } else {
        this.socket = io('/' + gameName);
      }
    }
  }

  /**
   * Creates a Redux store with some middleware that sends actions
   * to the server whenever they are dispatched.
   * @param {function} reducer - The game reducer.
   */
  createStore(reducer) {
    let store = null;

    const whiteListedActions = new Set([MAKE_MOVE, GAME_EVENT]);

    // Redux middleware to emit a message on a socket
    // whenever an action is dispatched.
    const SocketUpdate = ({ getState }) => next => action => {
      const state = getState();
      const result = next(action);

      if (whiteListedActions.has(action.type) && action._remote != true) {
        this.socket.emit(
          'action',
          action,
          state._id,
          this.gameID,
          this.playerID
        );
      }

      return result;
    };

    store = createStore(reducer, applyMiddleware(SocketUpdate));

    this.socket.on('sync', (gameID, state) => {
      if (gameID == this.gameID) {
        const action = ActionCreators.restore(state);
        action._remote = true;
        store.dispatch(action);
      }
    });

    // join a game
    this.socket.on('join', (gameID, playerID) => {
      console.log(
        this.playerName +
          ' is joining ' +
          gameID +
          ' as player ' +
          playerID +
          '.'
      );
      this.gameID = gameID;
      this.playerID = playerID;
      this._resolve(playerID, gameID);
    });

    // Initial sync to get game state.
    this.socket.emit(
      'sync',
      this.playerName,
      this.gameID,
      this.playerID,
      this.numPlayers
    );

    return store;
  }

  /**
   * Updates the game id.
   * @param {string} id - The new game id.
   */
  updateGameID(id) {
    this.gameID = this.gameName + ':' + id;

    if (this.socket) {
      this.socket.emit(
        'sync',
        this.playerName,
        this.gameID,
        this.playerID,
        this.numPlayers
      );
    }
  }

  /**
   * Updates the player associated with this client.
   * @param {string} id - The new player id.
   */
  updatePlayerID(id) {
    this.playerID = id;

    if (this.socket) {
      this.socket.emit(
        'sync',
        this.playerName,
        this.gameID,
        this.playerID,
        this.numPlayers
      );
    }
  }
}
