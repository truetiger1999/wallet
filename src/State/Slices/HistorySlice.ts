import { PayloadAction, createSlice } from '@reduxjs/toolkit';
import * as Types from '../../Api/autogenerated/ts/types'
import { mergeArrayValues, mergeRecords } from './dataMerge';
import { syncRedux } from '../store';
import loadInitialState, { MigrationFunction, applyMigrations, getStateAndVersion } from './migrations';
export const storageKey = "history"
type SourceOperations = Record<string /*nprofile*/, Types.UserOperation[]>
type Cursor = Partial<Types.GetUserOperationsRequest>
interface History {
  operations: SourceOperations
  cursor: Cursor
  latestOperation: Partial<Types.UserOperation>
  operationsUpdateHook: number
}

export const VERSION = 2;
export const migrations: Record<number, MigrationFunction<History>> = {
  // the missing latestOperation migration
  1: (state) => {
    const dummy: Record<string, any> = {
      operations: {},
      cursor: {},
      latestOperation: {},
      operationsUpdateHook: 0
    }
    const interfaceKeys = Object.keys(dummy);
    interfaceKeys.forEach(key => {
      if (state[key] === undefined) {
        state[key] = dummy[key]
      }
    })
    return state
  },
  2: (state: History) => {
    state.cursor = {};
    return state;
  }
};
export const mergeLogic = (serialLocal: string, serialRemote: string): string => {
  const local = getStateAndVersion(serialLocal);
  const remote = getStateAndVersion(serialRemote);

  const migratedRemote = applyMigrations(remote.state, remote.version, migrations);
  const migratedLocal = applyMigrations(local.state, local.version, migrations);

  const merged: History = {
    operations: mergeRecords<Types.UserOperation[]>(migratedLocal.operations || {}, migratedRemote.operations || {}, (l, r) => mergeArrayValues(l, r, v => v.operationId)),
    cursor: migratedLocal.cursor,
    latestOperation: migratedLocal.latestOperation,
    operationsUpdateHook: migratedLocal.operationsUpdateHook
  }
  return JSON.stringify({
    version: VERSION,
    data: merged
  });
}


const update = (value: History) => {
  const stateToSave = {
    version: VERSION,
    data: value,
  };
  localStorage.setItem(storageKey, JSON.stringify(stateToSave));
}

const initialState: History = loadInitialState(
  storageKey,
  JSON.stringify({ cursor: {}, operations: {}, latestOperation: {}, operationsUpdateHook: 0 }),
  migrations,
  update
);



const historySlice = createSlice({
  name: storageKey,
  initialState,
  reducers: {
    setSourceHistory: (state: History, action: PayloadAction<{ pub: string, operations: Types.UserOperation[], cursor: Cursor }>) => {
      const { pub, operations, cursor } = action.payload
      const stateOperations = state.operations[pub] || [];
      /* 
        Merge the two arrays, giving precedence to the dispatched operations
        to replace existing elements in state.operations.
        This is to update entries that were inserted with setLatestOperation
        where the status could be "Pending" and the fees inaccurate.
        This change is complimented by migration v2 that resets the cursor object
        to fix old operations from still being shown as "Pending"
      */
      const merged = [
        ...operations,
        ...stateOperations.filter(
          op1 => !operations.some(op2 => op2.operationId === op1.operationId)
        )
      ]
      state.operations[pub] = merged
      state.cursor = { ...cursor }
      state.operationsUpdateHook = Math.random()
      update(state)
    },
    setLatestOperation: (state, action: PayloadAction<{ pub: string, operation: Types.UserOperation }>) => {
      const { pub, operation } = action.payload
      state.latestOperation = { ...operation }
      if (!state.operations[pub]) {
        state.operations[pub] = [operation]
      } else {
        const existingIndex = state.operations[pub].findIndex(o => o.operationId === operation.operationId)
        if (existingIndex !== -1) {
          state.operations[pub][existingIndex] = { ...operation }
        } else {
          state.operations[pub].push(operation)
        }
      }
      state.operationsUpdateHook = Math.random()
      update(state)
    },
  },
  extraReducers: (builder) => {
    builder.addCase(syncRedux, () => {
      return loadInitialState(
        storageKey,
        JSON.stringify({ cursor: {}, operations: {}, latestOperation: {}, operationsUpdateHook: 0 }),
        migrations,
        update
      );
    })
  }
});

export const { setSourceHistory, setLatestOperation } = historySlice.actions;
export default historySlice.reducer;
