@EndUserText.label : 'T527X'
define table t527x {
  key mandt : abap.clnt not null;
  key sprsl : abap.lang not null;
  key orgeh : abap.char(8) not null;
  key endda : abap.dats not null;
  orgtx     : abap.char(40);
  begda     : abap.dats;
}
