// DDIC table types of the standard system that programs use without defining them (initial value: an empty table)
export const DDIC_TABLE_TYPES = new Set(['string_table', 'stringtab', 'string_t', 'xstring_table', 'char255_tab', 'abap_parmbind_tab', 'abap_excpbind_tab',
  'abap_component_tab', 'abap_attrdescr_tab', 'abap_keydescr_tab', 'soli_tab', 'solix_tab', 'tline_tab', 'ddfields', 'tihttpnvp', 'bapiret2_t', 'bapirettab',
  'rsdsselopt_t', 'rseloption', 'match_result_tab', 'submatch_result_tab', 'if_t100_message_tab']);
// DDIC structures of the standard system for batch input, report parameters and lists (initial values)
export const DDIC_STRUCTURES = {
  bdcdata: { program: '', dynpro: '0000', dynbegin: '', fnam: '', fval: '' },
  bdcmsgcoll: { tcode: '', dyname: '', dynumb: '', msgtyp: '', msgspra: '', msgid: '', msgnr: '', msgv1: '', msgv2: '', msgv3: '', msgv4: '', env: '', fldname: '' },
  rsparams: { selname: '', kind: '', sign: '', option: '', low: '', high: '' },
  abaplist: { rfcsize: 0, rfcrecord: '' },
  // forms (Interactive Forms by Adobe): output parameters, document parameters, the result
  sfpoutputparams: { nodialog: '', preview: '', getpdf: '', dest: '', reqnew: '', reqimm: '', reqdel: '', copies: 0, title: '', connection: '' },
  sfpdocparams: { langu: '', country: '', fillable: '', dynamic: '' },
  fpformoutput: { pdf: '', pages: 0 },
  sfpjoboutput: { remaining_pages: 0 },
};
