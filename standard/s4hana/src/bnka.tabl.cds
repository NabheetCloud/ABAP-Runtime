@EndUserText.label : 'Banks'
define table bnka {
  key mandt : abap.clnt not null;
  key banks : abap.char(3) not null;
  key bankl : abap.char(15) not null;
  banka     : abap.char(60);
  ort01     : abap.char(35);
  stras     : abap.char(35);
  swift     : abap.char(11);
  loevm     : abap.char(1);
}
