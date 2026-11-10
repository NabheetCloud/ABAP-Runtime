// Exception classes on the RAP runtime: the New Object template (get_text REDEFINITION of cx_root), T100 texts from a
// message class, a subclass of an app's exception class in another file; and the code checks know cx_root & co.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../src/server/server.js';
import { syntaxCheck } from '../src/check/abaplint.js';

const SRC = {
  'zcx_t_base.clas.abap': `"! Base error
CLASS zcx_t_base DEFINITION PUBLIC INHERITING FROM cx_static_check CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS constructor IMPORTING textid LIKE textid OPTIONAL previous LIKE previous OPTIONAL text TYPE string OPTIONAL.
    METHODS get_text REDEFINITION.
    METHODS get_longtext REDEFINITION.
  PROTECTED SECTION.
    DATA mv_text TYPE string.
ENDCLASS.
CLASS zcx_t_base IMPLEMENTATION.
  METHOD constructor ##ADT_SUPPRESS_GENERATION.
    super->constructor( textid = textid previous = previous ).
    mv_text = text.
  ENDMETHOD.
  METHOD get_text.
    result = COND #( WHEN mv_text IS NOT INITIAL THEN mv_text ELSE |Base error| ).
  ENDMETHOD.
  METHOD get_longtext.
    result = |Long: { get_text( ) }|.
  ENDMETHOD.
ENDCLASS.
`,
  'zcx_t_sub.clas.abap': `CLASS zcx_t_sub DEFINITION PUBLIC INHERITING FROM zcx_t_base FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS get_text REDEFINITION.
ENDCLASS.
CLASS zcx_t_sub IMPLEMENTATION.
  METHOD get_text.
    result = |Sub error|.
  ENDMETHOD.
ENDCLASS.
`,
  'zcx_t_msg.clas.abap': `CLASS zcx_t_msg DEFINITION PUBLIC INHERITING FROM cx_static_check FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_t100_dyn_msg.
    INTERFACES if_t100_message.
    CONSTANTS:
      BEGIN OF not_found,
        msgid TYPE symsgid VALUE 'ZTMSG',
        msgno TYPE symsgno VALUE '001',
        attr1 TYPE scx_attrname VALUE 'MV_KEY',
        attr2 TYPE scx_attrname VALUE '',
        attr3 TYPE scx_attrname VALUE '',
        attr4 TYPE scx_attrname VALUE '',
      END OF not_found.
    DATA mv_key TYPE string READ-ONLY.
    METHODS constructor IMPORTING textid LIKE if_t100_message=>t100key OPTIONAL previous LIKE previous OPTIONAL key TYPE string OPTIONAL.
ENDCLASS.
CLASS zcx_t_msg IMPLEMENTATION.
  METHOD constructor ##ADT_SUPPRESS_GENERATION.
    super->constructor( previous = previous ).
    mv_key = key.
    CLEAR me->textid.
    IF textid IS INITIAL.
      if_t100_message~t100key = if_t100_message=>default_textid.
    ELSE.
      if_t100_message~t100key = textid.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
`,
  'zcl_t_raise.clas.abap': `CLASS zcl_t_raise DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS zcl_t_raise IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    TRY.
        RAISE EXCEPTION NEW zcx_t_base( text = \`boom\` ).
      CATCH zcx_t_base INTO DATA(lx).
        out->write( |1 { lx->get_text( ) } / { lx->get_longtext( ) }| ).
    ENDTRY.
    TRY.
        RAISE EXCEPTION TYPE zcx_t_base.
      CATCH cx_static_check INTO DATA(ly).
        out->write( |2 { ly->get_text( ) }| ).
    ENDTRY.
    TRY.
        RAISE EXCEPTION NEW zcx_t_sub( previous = NEW zcx_t_base( text = \`inner\` ) ).
      CATCH cx_root INTO DATA(lz).
        out->write( |3 { lz->get_text( ) } / { lz->get_longtext( ) } / { lz->previous->get_text( ) }| ).
    ENDTRY.
    TRY.
        RAISE EXCEPTION TYPE zcx_t_msg EXPORTING textid = zcx_t_msg=>not_found key = \`42\`.
      CATCH zcx_t_msg INTO DATA(lm).
        out->write( |4 { lm->get_text( ) }| ).
    ENDTRY.
    RAISE EXCEPTION NEW zcx_t_base( text = \`uncaught\` ).
  ENDMETHOD.
ENDCLASS.
`,
  'ztmsg.msag.json': '{ "001": "Object &1 not found" }',
};

test('exception classes: get_text REDEFINITION, a subclass in another file, T100 texts, the dump text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-cx-'));
  fs.mkdirSync(path.join(dir, 'src'));
  for (const [f, s] of Object.entries(SRC)) fs.writeFileSync(path.join(dir, 'src', f), s);
  const ws = new Workspace(dir, { systemDir: false, lint: false });
  try {
    assert.deepEqual(ws.app.diagnostics.errors, []);
    const r = ws.runClass('zcl_t_raise');
    assert.match(r.output, /^1 boom \/ Long: boom$/m);
    assert.match(r.output, /^2 Base error$/m);
    assert.match(r.output, /^3 Sub error \/ Long: Sub error \/ inner$/m);
    assert.match(r.output, /^4 Object 42 not found$/m);
    assert.equal(r.ok, false);                                        // the last one is not caught: its text in the dump
    assert.match(r.error, /uncaught/);
    // the code checks: no "Super class cx_static_check not found", no "zcx_... not found" in the users
    const lint = syntaxCheck(dir);
    assert.deepEqual([...lint.errors, ...lint.warnings].map(w => w.message), []);
  } finally { ws.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
