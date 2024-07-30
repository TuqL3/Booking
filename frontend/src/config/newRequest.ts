import axios from "axios";

const newRequest = axios.create({
    baseURL: "http://localhost:7000",
    withCredentials: true
})

export default newRequest