@EndUserText.label : 'Supplier bank details'
define table lfbk {
  key mandt : abap.clnt not null;
  key lifnr : abap.char(10) not null;
  key banks : abap.char(3) not null;
  key bankl : abap.char(15) not null;
  key bankn : abap.char(18) not null;
  bkont     : abap.char(10);
  bvtyp     : abap.char(20);
}
