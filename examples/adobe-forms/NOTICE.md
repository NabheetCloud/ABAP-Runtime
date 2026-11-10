# Adobe forms reference app

SAP's cinema ticket sample ([SAP-samples/forms-service-by-adobe-samples](https://github.com/SAP-samples/forms-service-by-adobe-samples),
`abap/zfoba_cinema_demo` and `forms/ZF_CINE_TICKET.xdp`) running in RAP Studio: the XDP layout, the CDS views and the
service definition are SAP's, unchanged; the database tables are the sample's tables as `.tabl.cds`; the console class
`ZCL_CINE_PRINT_TICKET` makes the calls of the sample's render operation (`ZCL_CINE_APP_OP_RENDER`). The seed data's
picture is part of SAP's documentation of the sample.

Copyright SAP SE or an SAP affiliate company and contributors, licensed under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) (full text in [LICENSE-Apache-2.0.txt](LICENSE-Apache-2.0.txt)).

Try it (in this folder): `rap form ZF_CINE_TICKET ID=06DBE970F30C1FE0AF991A962D17E17B --out ticket.pdf`,
`rap run . zcl_cine_print_ticket`, `rap form check`.
